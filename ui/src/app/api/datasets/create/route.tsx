import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper function to analyze JSON files and extract available attributes
async function analyzeJsonAttributes(targetDir: string) {
  try {
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

    findJsonFiles(targetDir);

    // Analyze up to 10 JSON files to find common attributes
    const attributeFrequency: { [key: string]: number } = {};
    const maxSamples = Math.min(10, jsonFiles.length);

    for (let i = 0; i < maxSamples; i++) {
      try {
        const jsonContent = fs.readFileSync(jsonFiles[i], 'utf-8');
        const jsonData = JSON.parse(jsonContent);
        
        if (typeof jsonData === 'object' && jsonData !== null) {
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

    // Sort attributes by frequency and return as array
    const availableAttributes = Object.keys(attributeFrequency)
      .map(attr => ({
        name: attr,
        frequency: attributeFrequency[attr],
        percentage: Math.round((attributeFrequency[attr] / maxSamples) * 100)
      }))
      .sort((a, b) => b.frequency - a.frequency);

    return availableAttributes;
  } catch (error) {
    console.error('Error analyzing JSON attributes:', error);
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let { name, type = 'local', externalPath } = body;
    
    // clean name by making lower case,  removing special characters, and replacing spaces with underscores
    name = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');

    let datasetsPath = await getDatasetsRoot();
    let datasetPath = path.join(datasetsPath, name);

    if (type === 'linked') {
      // For linked datasets, verify the external path exists
      if (!externalPath || !fs.existsSync(externalPath)) {
        return NextResponse.json({ error: 'External path does not exist' }, { status: 400 });
      }

      // Create a working directory for cache only
      const cacheDir = path.join(datasetPath, '.cache');
      if (!fs.existsSync(datasetPath)) {
        fs.mkdirSync(datasetPath, { recursive: true });
      }
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // Analyze JSON attributes in the external directory
      const availableAttributes = await analyzeJsonAttributes(externalPath);
      
      // Store the dataset info in database
      await prisma.dataset.create({
        data: {
          name,
          type: 'linked',
          external_path: externalPath,
          available_attributes: availableAttributes.length > 0 ? JSON.stringify(availableAttributes) : null,
        },
      });

      // Create a marker file to indicate this is a linked dataset
      fs.writeFileSync(
        path.join(datasetPath, '.linked'),
        JSON.stringify({ 
          externalPath,
          createdAt: new Date().toISOString()
        })
      );

    } else {
      // For local datasets, create the folder normally
      if (!fs.existsSync(datasetPath)) {
        fs.mkdirSync(datasetPath);
      }

      // Analyze JSON attributes in the local directory (if any JSON files exist)
      const availableAttributes = await analyzeJsonAttributes(datasetPath);

      // Store in database
      await prisma.dataset.create({
        data: {
          name,
          type: 'local',
          available_attributes: availableAttributes.length > 0 ? JSON.stringify(availableAttributes) : null,
        },
      });
    }

    return NextResponse.json({ success: true, name: name, type });
  } catch (error) {
    console.error('Error creating dataset:', error);
    return NextResponse.json({ error: 'Failed to create dataset' }, { status: 500 });
  }
}
