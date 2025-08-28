/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  
  const body = await request.json();
  const { imgPath, datasetName } = body;
  console.log('Received POST request for caption:', imgPath);
  try {
    // Decode the path
    const filepath = imgPath;
    console.log('Decoded image path:', filepath);

    // Get dataset configuration for caption format
    let captionFormat = 'txt';
    let jsonAttribute = 'tags';
    
    if (datasetName) {
      try {
        const dataset = await prisma.dataset.findUnique({
          where: { name: datasetName }
        });
        if (dataset) {
          captionFormat = dataset.caption_format;
          jsonAttribute = dataset.json_attribute;
        }
      } catch (error) {
        console.error('Error fetching dataset config:', error);
      }
    }

    // Try JSON format first if configured, then fallback to txt
    let captionContent = '';
    
    if (captionFormat === 'json') {
      const jsonPath = filepath.replace(/\.[^/.]+$/, '') + '.json';
      if (fs.existsSync(jsonPath)) {
        try {
          const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
          const jsonData = JSON.parse(jsonContent);
          captionContent = jsonData[jsonAttribute] || '';
          
          // If the specified attribute doesn't exist, try common alternatives
          if (!captionContent) {
            const alternatives = ['tags', 'text', 'caption', 'description', 'prompt'];
            for (const alt of alternatives) {
              if (jsonData[alt]) {
                captionContent = jsonData[alt];
                break;
              }
            }
          }
        } catch (error) {
          console.error('Error parsing JSON caption:', error);
        }
      }
    }
    
    // Fallback to txt format if JSON didn't work or wasn't found
    if (!captionContent) {
      const txtPath = filepath.replace(/\.[^/.]+$/, '') + '.txt';
      if (fs.existsSync(txtPath)) {
        captionContent = fs.readFileSync(txtPath, 'utf-8');
      }
    }

    // Get allowed directories
    const datasetRoot = await getDatasetsRoot();
    let allowedDirs = [datasetRoot];

    // Add external paths from linked datasets
    try {
      const linkedDatasets = await prisma.dataset.findMany({
        where: { type: 'linked' }
      });
      
      for (const dataset of linkedDatasets) {
        if (dataset.external_path) {
          allowedDirs.push(dataset.external_path);
        }
      }
    } catch (error) {
      console.error('Error fetching linked datasets:', error);
    }

    // Security check: Ensure path is in allowed directory
    const isAllowed = allowedDirs.some(allowedDir => filepath.startsWith(allowedDir)) && !filepath.includes('..');

    if (!isAllowed) {
      console.warn(`Access denied: ${filepath} not in ${allowedDirs.join(', ')}`);
      return new NextResponse('Access denied', { status: 403 });
    }

    // Return caption content (may be empty if no caption file found)
    return new NextResponse(captionContent);
  } catch (error) {
    console.error('Error getting caption:', error);
    return new NextResponse('Error getting caption', { status: 500 });
  }
}
