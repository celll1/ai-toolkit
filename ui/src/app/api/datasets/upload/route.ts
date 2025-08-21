// src/app/api/datasets/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, access } from 'fs/promises';
import { join, extname, basename } from 'path';
import { getDatasetsRoot } from '@/server/settings';

export async function POST(request: NextRequest) {
  try {
    const datasetsPath = await getDatasetsRoot();
    if (!datasetsPath) {
      return NextResponse.json({ error: 'Datasets path not found' }, { status: 500 });
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (error) {
      console.error('FormData parsing error:', error);
      return NextResponse.json({ error: 'Failed to parse uploaded data' }, { status: 400 });
    }

    const files = formData.getAll('files');
    const paths = formData.getAll('paths'); // webkitRelativePath values
    const datasetName = formData.get('datasetName') as string;

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    // Create upload directory if it doesn't exist
    const uploadDir = join(datasetsPath, datasetName);
    await mkdir(uploadDir, { recursive: true });

    const savedFiles: string[] = [];
    const fileNameMap = new Map<string, number>(); // Track filename duplicates
    
    // Process files sequentially to avoid overwhelming the system
    for (let i = 0; i < files.length; i++) {
      const file = files[i] as File;
      const relativePath = paths[i] as string || file.name;
      
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Extract filename from relative path and clean it
      let originalName = basename(relativePath);
      const fileExt = extname(originalName);
      const nameWithoutExt = basename(originalName, fileExt);
      
      // Clean filename (remove special characters except dots and underscores)
      const cleanName = nameWithoutExt.replace(/[^a-zA-Z0-9._-]/g, '_');
      
      // Handle duplicate filenames by adding suffix
      let finalFileName = cleanName + fileExt;
      if (fileNameMap.has(finalFileName)) {
        const count = fileNameMap.get(finalFileName)! + 1;
        fileNameMap.set(finalFileName, count);
        finalFileName = `${cleanName}_${count}${fileExt}`;
      } else {
        fileNameMap.set(finalFileName, 0);
      }

      // Ensure the final filename is unique on disk too
      let uniqueFileName = finalFileName;
      let counter = 1;
      while (true) {
        const filePath = join(uploadDir, uniqueFileName);
        try {
          await access(filePath);
          // File exists, try next number
          const nameWithoutExt = basename(finalFileName, extname(finalFileName));
          uniqueFileName = `${nameWithoutExt}_${counter}${extname(finalFileName)}`;
          counter++;
        } catch {
          // File doesn't exist, we can use this name
          break;
        }
      }

      const finalPath = join(uploadDir, uniqueFileName);
      await writeFile(finalPath, buffer);
      savedFiles.push(uniqueFileName);
    }

    return NextResponse.json({
      message: 'Files uploaded successfully',
      files: savedFiles,
      totalFiles: files.length,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ 
      error: 'Error uploading files', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Increase payload size limit (default is 4mb)
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '50mb',
  },
};
