import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
const CAPTION_EXTENSIONS = ['.txt', '.caption', '.json'];

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
    
    console.log(`[Random Caption] Selected image: ${randomImagePath}`);
    console.log(`[Random Caption] Looking for captions with base name: ${imageBaseName}`);
    
    // Look for corresponding caption file
    for (const captionExt of CAPTION_EXTENSIONS) {
      const captionPath = path.join(imageDir, imageBaseName + captionExt);
      
      if (fs.existsSync(captionPath)) {
        try {
          const fileContent = fs.readFileSync(captionPath, 'utf-8').trim();
          if (fileContent) {
            let caption = fileContent;
            
            // Handle JSON files
            if (captionExt === '.json') {
              try {
                const jsonData = JSON.parse(fileContent);
                // Try common caption fields
                caption = jsonData.caption || jsonData.prompt || jsonData.description || jsonData.tags || 
                         (typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData));
              } catch (jsonError) {
                console.error(`Error parsing JSON caption file ${captionPath}:`, jsonError);
                continue; // Skip this file and try next extension
              }
            }
            
            if (caption && typeof caption === 'string' && caption.trim()) {
              console.log(`[Random Caption] Found caption file: ${captionPath}`);
              console.log(`[Random Caption] Caption content: ${caption}`);
              return caption.trim();
            }
          }
        } catch (error) {
          console.error(`Error reading caption file ${captionPath}:`, error);
        }
      }
    }
    
    // If no caption file found, return the image filename without extension as fallback
    console.log(`[Random Caption] No caption file found, using filename as fallback: ${imageBaseName}`);
    return imageBaseName.replace(/[_-]/g, ' ');
    
  } catch (error) {
    console.error(`Error getting random caption from ${datasetPath}:`, error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { datasetName } = await request.json();
    
    console.log(`[Random Caption] Requested dataset: ${datasetName}`);
    
    if (!datasetName) {
      return NextResponse.json({ error: 'Dataset name is required' }, { status: 400 });
    }
    
    const datasetsRoot = await getDatasetsRoot();
    let datasetPath = path.join(datasetsRoot, datasetName);
    
    console.log(`[Random Caption] Initial dataset path: ${datasetPath}`);
    
    if (!fs.existsSync(datasetPath)) {
      return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
    }
    
    // Check if this is a linked dataset
    const linkedMarker = path.join(datasetPath, '.linked');
    if (fs.existsSync(linkedMarker)) {
      try {
        const linkInfo = JSON.parse(fs.readFileSync(linkedMarker, 'utf8'));
        const externalPath = linkInfo.externalPath;
        
        if (externalPath && fs.existsSync(externalPath)) {
          // Use external path for linked dataset
          console.log(`[Random Caption] Using linked dataset path: ${externalPath}`);
          datasetPath = externalPath;
        } else {
          return NextResponse.json({ error: 'External dataset path does not exist' }, { status: 404 });
        }
      } catch (e) {
        console.error('Error reading linked dataset info:', e);
        return NextResponse.json({ error: 'Failed to read linked dataset information' }, { status: 500 });
      }
    } else {
      console.log(`[Random Caption] Using local dataset path: ${datasetPath}`);
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