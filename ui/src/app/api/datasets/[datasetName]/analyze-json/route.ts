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
  try {
    const { datasetName } = await params;
    
    const dataset = await prisma.dataset.findUnique({
      where: { name: datasetName }
    });

    if (!dataset) {
      return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
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

    // Find JSON files in the dataset
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

    // Security check: Ensure path is in allowed directory
    const isAllowed = allowedDirs.some(allowedDir => targetDir.startsWith(allowedDir)) && !targetDir.includes('..');

    if (!isAllowed) {
      console.warn(`Access denied: ${targetDir} not in ${allowedDirs.join(', ')}`);
      return new NextResponse('Access denied', { status: 403 });
    }

    if (!fs.existsSync(targetDir)) {
      return NextResponse.json({ 
        error: 'Dataset directory not found',
        availableAttributes: [],
        sampleCount: 0
      });
    }

    findJsonFiles(targetDir);

    // Analyze up to 10 JSON files to find common attributes
    const attributeFrequency: { [key: string]: number } = {};
    const sampleData: any[] = [];
    const maxSamples = Math.min(10, jsonFiles.length);

    for (let i = 0; i < maxSamples; i++) {
      try {
        const jsonContent = fs.readFileSync(jsonFiles[i], 'utf-8');
        const jsonData = JSON.parse(jsonContent);
        
        if (typeof jsonData === 'object' && jsonData !== null) {
          sampleData.push(jsonData);
          
          // Count occurrences of each attribute
          for (const key of Object.keys(jsonData)) {
            if (typeof jsonData[key] === 'string' && jsonData[key].trim()) {
              attributeFrequency[key] = (attributeFrequency[key] || 0) + 1;
            }
          }
        }
      } catch (error) {
        console.error(`Error parsing JSON file ${jsonFiles[i]}:`, error);
      }
    }

    // Sort attributes by frequency (most common first)
    const availableAttributes = Object.keys(attributeFrequency)
      .map(attr => ({
        name: attr,
        frequency: attributeFrequency[attr],
        percentage: Math.round((attributeFrequency[attr] / maxSamples) * 100)
      }))
      .sort((a, b) => b.frequency - a.frequency);

    // Save the analyzed attributes to the database for future use
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

    return NextResponse.json({
      availableAttributes,
      totalJsonFiles: jsonFiles.length,
      sampledFiles: maxSamples,
      sampleData: sampleData.slice(0, 3) // Return first 3 samples for preview
    });

  } catch (error) {
    console.error('Error analyzing JSON files:', error);
    return NextResponse.json({ error: 'Failed to analyze JSON files' }, { status: 500 });
  }
}