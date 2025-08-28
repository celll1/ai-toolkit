import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name } = body;
    let datasetsPath = await getDatasetsRoot();
    let datasetPath = path.join(datasetsPath, name);

    // Check if this is a linked dataset
    const dataset = await prisma.dataset.findUnique({
      where: { name }
    });

    if (dataset && dataset.type === 'linked') {
      // For linked datasets, ONLY delete the cache directory, never the external path
      console.log(`Deleting linked dataset cache for: ${name}`);
      
      // Only delete the working directory (cache), NOT the external path
      if (fs.existsSync(datasetPath)) {
        // Double check this is really a linked dataset by checking for marker file
        const linkedMarker = path.join(datasetPath, '.linked');
        if (fs.existsSync(linkedMarker)) {
          // Safe to delete only the cache directory
          fs.rmSync(datasetPath, { recursive: true, force: true });
          console.log(`Deleted cache directory: ${datasetPath}`);
        }
      }
      
      // Remove from database
      await prisma.dataset.delete({
        where: { name }
      });

      // NEVER delete the external_path!
      console.log(`External path preserved: ${dataset.external_path}`);
      
    } else {
      // For local datasets, delete normally
      if (fs.existsSync(datasetPath)) {
        fs.rmSync(datasetPath, { recursive: true, force: true });
      }
      
      // Remove from database if exists
      if (dataset) {
        await prisma.dataset.delete({
          where: { name }
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting dataset:', error);
    return NextResponse.json({ error: 'Failed to delete dataset' }, { status: 500 });
  }
}
