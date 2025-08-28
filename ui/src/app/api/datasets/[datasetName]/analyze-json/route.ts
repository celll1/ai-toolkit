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

    // Find JSON files and image files in the dataset
    const jsonFiles: string[] = [];
    const imageFiles: string[] = [];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
    
    const findFiles = (dir: string) => {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            findFiles(fullPath);
          } else {
            const ext = path.extname(item).toLowerCase();
            if (ext === '.json') {
              jsonFiles.push(fullPath);
            } else if (imageExtensions.includes(ext)) {
              imageFiles.push(fullPath);
            }
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

    findFiles(targetDir);

    // Analyze ALL JSON files to find accurate attribute frequencies
    const attributeFrequency: { [key: string]: number } = {};
    const attributeTypes: { [key: string]: { type: string, values: Set<any>, min?: number, max?: number } } = {};
    const sampleData: any[] = [];
    const totalJsonFiles = jsonFiles.length;
    const totalImages = imageFiles.length;

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

    // Process all JSON files for accurate statistics
    for (let i = 0; i < totalJsonFiles; i++) {
      try {
        const jsonContent = fs.readFileSync(jsonFiles[i], 'utf-8');
        const jsonData = JSON.parse(jsonContent);
        
        if (typeof jsonData === 'object' && jsonData !== null) {
          // Keep only first 3 samples for preview
          if (sampleData.length < 3) {
            sampleData.push(jsonData);
          }
          analyzeNestedObject(jsonData);
        }
      } catch (error) {
        console.error(`Error parsing JSON file ${jsonFiles[i]}:`, error);
      }
    }

    // Sort attributes by frequency (most common first)
    // Calculate percentage based on total images, not just JSON files
    const availableAttributes = Object.keys(attributeFrequency)
      .map(attr => ({
        name: attr,
        type: attributeTypes[attr]?.type || 'unknown',
        frequency: attributeFrequency[attr],
        percentage: Math.round((attributeFrequency[attr] / totalImages) * 100),
        min: attributeTypes[attr]?.min,
        max: attributeTypes[attr]?.max,
        uniqueValues: Array.from(attributeTypes[attr]?.values || []).slice(0, 10) // Limit to 10 unique values for display
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
      totalJsonFiles,
      totalImages,
      processedFiles: totalJsonFiles,
      missingJsonFiles: totalImages - totalJsonFiles,
      sampleData: sampleData // Already limited to first 3 samples
    });

  } catch (error) {
    console.error('Error analyzing JSON files:', error);
    return NextResponse.json({ error: 'Failed to analyze JSON files' }, { status: 500 });
  }
}