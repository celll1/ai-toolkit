import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];

function countImagesInDirectory(dirPath: string, excludeDirs: string[] = []): number {
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    let count = 0;
    
    for (const file of files) {
      if (file.isFile()) {
        const ext = path.extname(file.name).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(ext)) {
          count++;
        }
      } else if (file.isDirectory() && !excludeDirs.includes(file.name)) {
        // Recursively count images in subdirectories
        const subDirPath = path.join(dirPath, file.name);
        count += countImagesInDirectory(subDirPath, excludeDirs);
      }
    }
    
    return count;
  } catch (error) {
    console.error(`Error counting images in ${dirPath}:`, error);
    return 0;
  }
}

export async function GET() {
  try {
    let datasetsPath = await getDatasetsRoot();

    // if folder doesnt exist, create it
    if (!fs.existsSync(datasetsPath)) {
      fs.mkdirSync(datasetsPath);
    }

    // Get all datasets from database
    const datasets = await prisma.dataset.findMany();
    const datasetMap = new Map(datasets.map(d => [d.name, d]));

    // find all the folders in the datasets folder
    let folders = fs
      .readdirSync(datasetsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .filter(dirent => !dirent.name.startsWith('.'))
      .map(dirent => {
        const folderPath = path.join(datasetsPath, dirent.name);
        const dataset = datasetMap.get(dirent.name);
        
        let imageCount = 0;
        let type = 'local';
        let externalPath = null;
        
        // Check if this is a linked dataset
        const linkedMarker = path.join(folderPath, '.linked');
        if (fs.existsSync(linkedMarker)) {
          type = 'linked';
          try {
            const linkInfo = JSON.parse(fs.readFileSync(linkedMarker, 'utf8'));
            externalPath = linkInfo.externalPath;
            // Count images from external path, excluding cache directory
            if (externalPath && fs.existsSync(externalPath)) {
              imageCount = countImagesInDirectory(externalPath, ['.cache']);
            }
          } catch (e) {
            console.error('Error reading linked dataset info:', e);
          }
        } else {
          // Count images in local dataset
          imageCount = countImagesInDirectory(folderPath);
        }
        
        return {
          name: dirent.name,
          imageCount: imageCount,
          type: dataset?.type || type,
          externalPath: dataset?.external_path || externalPath,
        };
      });

    return NextResponse.json(folders);
  } catch (error) {
    console.error('Error fetching datasets:', error);
    return NextResponse.json({ error: 'Failed to fetch datasets' }, { status: 500 });
  }
}
