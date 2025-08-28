/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  
  const body = await request.json();
  const { imgPath } = body;
  console.log('Received POST request for caption:', imgPath);
  try {
    // Decode the path
    const filepath = imgPath;
    console.log('Decoded image path:', filepath);

    // caption name is the filepath without extension but with .txt
    const captionPath = filepath.replace(/\.[^/.]+$/, '') + '.txt';

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

    // Check if file exists
    if (!fs.existsSync(captionPath)) {
      // send back blank string if caption file does not exist
      return new NextResponse('');
    }

    // Read caption file
    const caption = fs.readFileSync(captionPath, 'utf-8');

    // Return caption
    return new NextResponse(caption);
  } catch (error) {
    console.error('Error getting caption:', error);
    return new NextResponse('Error getting caption', { status: 500 });
  }
}
