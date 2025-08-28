import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  { params }: { params: { datasetName: string } }
) {
  const { datasetName } = await params;
  
  // Set up Server-Sent Events
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      processJsonFiles(datasetName, controller, encoder);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function processJsonFiles(datasetName: string, controller: ReadableStreamDefaultController, encoder: TextEncoder) {
  try {
    const dataset = await prisma.dataset.findUnique({
      where: { name: datasetName }
    });

    if (!dataset) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Dataset not found' })}\n\n`));
      controller.close();
      return;
    }

    // Get allowed directories
    const datasetRoot = await getDatasetsRoot();
    let allowedDirs = [datasetRoot];
    let targetDir = path.join(datasetRoot, datasetName);

    // Add external paths from linked datasets
    if (dataset.type === 'linked' && dataset.external_path) {
      allowedDirs.push(dataset.external_path);
      targetDir = dataset.external_path;
    }

    // Security check: Ensure path is in allowed directory
    const isAllowed = allowedDirs.some(allowedDir => targetDir.startsWith(allowedDir)) && !targetDir.includes('..');

    if (!isAllowed) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Access denied' })}\n\n`));
      controller.close();
      return;
    }

    if (!fs.existsSync(targetDir)) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Dataset directory not found' })}\n\n`));
      controller.close();
      return;
    }

    // Find JSON files
    const jsonFiles: string[] = [];
    const findJsonFiles = (dir: string) => {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            findJsonFiles(fullPath);
          } else if (item.toLowerCase().endsWith('.json')) {
            jsonFiles.push(fullPath);
          }
        }
      } catch (error) {
        console.error('Error reading directory:', error);
      }
    };

    findJsonFiles(targetDir);

    const totalFiles = jsonFiles.length;
    if (totalFiles === 0) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'No JSON files found' })}\n\n`));
      controller.close();
      return;
    }

    // Send initial progress
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
      type: 'start', 
      totalFiles,
      message: `Starting analysis of ${totalFiles} JSON files...` 
    })}\n\n`));

    // Analyze files with progress updates
    const attributeFrequency: { [key: string]: number } = {};
    const attributeTypes: { [key: string]: { type: string, values: Set<any>, min?: number, max?: number } } = {};
    const sampleData: any[] = [];

    // Helper function to analyze nested objects
    const analyzeNestedObject = (obj: any, prefix: string = '') => {
      for (const key of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const value = obj[key];
        
        if (typeof value === 'string' && value.trim()) {
          attributeFrequency[fullKey] = (attributeFrequency[fullKey] || 0) + 1;
          if (!attributeTypes[fullKey]) {
            attributeTypes[fullKey] = { type: 'string', values: new Set() };
          }
        } else if (typeof value === 'number') {
          attributeFrequency[fullKey] = (attributeFrequency[fullKey] || 0) + 1;
          if (!attributeTypes[fullKey]) {
            attributeTypes[fullKey] = { type: 'number', values: new Set(), min: value, max: value };
          } else {
            attributeTypes[fullKey].min = Math.min(attributeTypes[fullKey].min || value, value);
            attributeTypes[fullKey].max = Math.max(attributeTypes[fullKey].max || value, value);
          }
          attributeTypes[fullKey].values.add(value);
        } else if (typeof value === 'boolean') {
          attributeFrequency[fullKey] = (attributeFrequency[fullKey] || 0) + 1;
          if (!attributeTypes[fullKey]) {
            attributeTypes[fullKey] = { type: 'boolean', values: new Set() };
          }
          attributeTypes[fullKey].values.add(value);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Recursively analyze nested objects (1 level deep only for simplicity)
          if (!prefix) {
            analyzeNestedObject(value, fullKey);
          }
        }
      }
    };

    for (let i = 0; i < totalFiles; i++) {
      try {
        const jsonContent = fs.readFileSync(jsonFiles[i], 'utf-8');
        const jsonData = JSON.parse(jsonContent);
        
        if (typeof jsonData === 'object' && jsonData !== null) {
          if (sampleData.length < 3) {
            sampleData.push(jsonData);
          }
          analyzeNestedObject(jsonData);
        }

        // Send progress updates every 100 files or at the end
        if ((i + 1) % 100 === 0 || i === totalFiles - 1) {
          const progress = Math.round(((i + 1) / totalFiles) * 100);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress', 
            current: i + 1,
            total: totalFiles,
            percentage: progress,
            message: `Processed ${i + 1}/${totalFiles} files (${progress}%)`
          })}\n\n`));
        }
      } catch (error) {
        console.error(`Error parsing JSON file ${jsonFiles[i]}:`, error);
      }
    }

    // Prepare results
    const availableAttributes = Object.keys(attributeFrequency)
      .map(attr => ({
        name: attr,
        type: attributeTypes[attr]?.type || 'unknown',
        frequency: attributeFrequency[attr],
        percentage: Math.round((attributeFrequency[attr] / totalFiles) * 100),
        min: attributeTypes[attr]?.min,
        max: attributeTypes[attr]?.max,
        uniqueValues: Array.from(attributeTypes[attr]?.values || []).slice(0, 10)
      }))
      .sort((a, b) => b.frequency - a.frequency);

    // Save to database
    try {
      await prisma.dataset.update({
        where: { name: datasetName },
        data: {
          available_attributes: availableAttributes.length > 0 ? JSON.stringify(availableAttributes) : null,
        },
      });
    } catch (error) {
      console.error('Error saving available attributes to database:', error);
    }

    // Send final results
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
      type: 'complete',
      availableAttributes,
      totalJsonFiles: totalFiles,
      processedFiles: totalFiles,
      sampleData
    })}\n\n`));

    controller.close();

  } catch (error) {
    console.error('Error in JSON analysis:', error);
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
      type: 'error',
      error: 'Failed to analyze JSON files' 
    })}\n\n`));
    controller.close();
  }
}