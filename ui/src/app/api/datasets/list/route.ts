import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];

function countImagesInDirectory(dirPath: string): number {
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    let count = 0;
    
    for (const file of files) {
      if (file.isFile()) {
        const ext = path.extname(file.name).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(ext)) {
          count++;
        }
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

    // find all the folders in the datasets folder
    let folders = fs
      .readdirSync(datasetsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .filter(dirent => !dirent.name.startsWith('.'))
      .map(dirent => {
        const folderPath = path.join(datasetsPath, dirent.name);
        const imageCount = countImagesInDirectory(folderPath);
        return {
          name: dirent.name,
          imageCount: imageCount,
        };
      });

    return NextResponse.json(folders);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch datasets' }, { status: 500 });
  }
}
