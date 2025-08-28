import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  const datasetsPath = await getDatasetsRoot();
  const body = await request.json();
  const { datasetName } = body;
  const datasetFolder = path.join(datasetsPath, datasetName);

  try {
    // Check if folder exists
    if (!fs.existsSync(datasetFolder)) {
      return NextResponse.json({ error: `Folder '${datasetName}' not found` }, { status: 404 });
    }

    let imageFiles: string[] = [];
    
    // Check if this is a linked dataset
    const linkedMarker = path.join(datasetFolder, '.linked');
    if (fs.existsSync(linkedMarker)) {
      // This is a linked dataset, read from external path
      try {
        const linkInfo = JSON.parse(fs.readFileSync(linkedMarker, 'utf8'));
        const externalPath = linkInfo.externalPath;
        
        if (externalPath && fs.existsSync(externalPath)) {
          // Find images in the external path
          imageFiles = findImagesRecursively(externalPath, ['.cache']);
        } else {
          console.error('External path does not exist:', externalPath);
        }
      } catch (e) {
        console.error('Error reading linked dataset info:', e);
      }
    } else {
      // Regular local dataset
      imageFiles = findImagesRecursively(datasetFolder);
    }

    // Format response
    const result = imageFiles.map(imgPath => ({
      img_path: imgPath,
    }));

    return NextResponse.json({ images: result });
  } catch (error) {
    console.error('Error finding images:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}

/**
 * Recursively finds all image files in a directory and its subdirectories
 * @param dir Directory to search
 * @param excludeDirs Array of directory names to exclude from search
 * @returns Array of absolute paths to image files
 */
function findImagesRecursively(dir: string, excludeDirs: string[] = []): string[] {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.m4v', '.flv'];
  let results: string[] = [];

  const items = fs.readdirSync(dir);

  for (const item of items) {
    const itemPath = path.join(dir, item);
    const stat = fs.statSync(itemPath);

    if (stat.isDirectory() && item !== '_controls' && !item.startsWith('.') && !excludeDirs.includes(item)) {
      // If it's a directory, recursively search it
      results = results.concat(findImagesRecursively(itemPath, excludeDirs));
    } else {
      // If it's a file, check if it's an image
      const ext = path.extname(itemPath).toLowerCase();
      if (imageExtensions.includes(ext)) {
        results.push(itemPath);
      }
    }
  }

  return results;
}
