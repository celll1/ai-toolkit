import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
const CAPTION_EXTENSIONS = ['.txt', '.caption'];

function getRandomCaption(datasetPath: string): string | null {
  try {
    const files = fs.readdirSync(datasetPath, { withFileTypes: true });
    const imageFiles: string[] = [];
    
    // Collect all image files recursively
    function collectImages(dirPath: string) {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        
        if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (IMAGE_EXTENSIONS.includes(ext)) {
            imageFiles.push(fullPath);
          }
        } else if (item.isDirectory()) {
          collectImages(fullPath);
        }
      }
    }
    
    collectImages(datasetPath);
    
    if (imageFiles.length === 0) {
      return null;
    }
    
    // Randomly select an image file
    const randomImagePath = imageFiles[Math.floor(Math.random() * imageFiles.length)];
    const imageBaseName = path.parse(randomImagePath).name;
    const imageDir = path.dirname(randomImagePath);
    
    // Look for corresponding caption file
    for (const captionExt of CAPTION_EXTENSIONS) {
      const captionPath = path.join(imageDir, imageBaseName + captionExt);
      
      if (fs.existsSync(captionPath)) {
        try {
          const caption = fs.readFileSync(captionPath, 'utf-8').trim();
          if (caption) {
            return caption;
          }
        } catch (error) {
          console.error(`Error reading caption file ${captionPath}:`, error);
        }
      }
    }
    
    // If no caption file found, return the image filename without extension as fallback
    return imageBaseName.replace(/[_-]/g, ' ');
    
  } catch (error) {
    console.error(`Error getting random caption from ${datasetPath}:`, error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { datasetName } = await request.json();
    
    if (!datasetName) {
      return NextResponse.json({ error: 'Dataset name is required' }, { status: 400 });
    }
    
    const datasetsRoot = await getDatasetsRoot();
    const datasetPath = path.join(datasetsRoot, datasetName);
    
    if (!fs.existsSync(datasetPath)) {
      return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
    }
    
    const caption = getRandomCaption(datasetPath);
    
    if (!caption) {
      return NextResponse.json({ error: 'No captions found in dataset' }, { status: 404 });
    }
    
    return NextResponse.json({ caption });
    
  } catch (error) {
    console.error('Error fetching random caption:', error);
    return NextResponse.json({ error: 'Failed to fetch random caption' }, { status: 500 });
  }
}