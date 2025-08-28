import { NextRequest, NextResponse } from 'next/server';
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

export async function POST(request: NextRequest) {
  try {
    // Get all datasets from database
    const datasets = await prisma.dataset.findMany();
    const datasetRoot = await getDatasetsRoot();
    
    const results = [];
    let processed = 0;
    let updated = 0;

    for (const dataset of datasets) {
      try {
        // Determine the directory to analyze
        let targetDir: string;
        if (dataset.type === 'linked' && dataset.external_path) {
          targetDir = dataset.external_path;
        } else {
          targetDir = path.join(datasetRoot, dataset.name);
        }

        // Check if directory exists
        if (!fs.existsSync(targetDir)) {
          console.warn(`Dataset directory does not exist: ${targetDir}`);
          processed++;
          continue;
        }

        // Analyze JSON attributes
        const availableAttributes = await analyzeJsonAttributes(targetDir);
        
        // Update database if attributes were found
        if (availableAttributes.length > 0) {
          await prisma.dataset.update({
            where: { id: dataset.id },
            data: {
              available_attributes: JSON.stringify(availableAttributes),
            },
          });
          updated++;
        }

        processed++;
        results.push({
          name: dataset.name,
          type: dataset.type,
          attributesFound: availableAttributes.length,
          attributes: availableAttributes.map(attr => attr.name)
        });

      } catch (error) {
        console.error(`Error processing dataset ${dataset.name}:`, error);
        processed++;
        results.push({
          name: dataset.name,
          type: dataset.type,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalDatasets: datasets.length,
        processed,
        updated,
        failed: processed - updated
      },
      results
    });

  } catch (error) {
    console.error('Error analyzing all datasets:', error);
    return NextResponse.json({ error: 'Failed to analyze datasets' }, { status: 500 });
  }
}