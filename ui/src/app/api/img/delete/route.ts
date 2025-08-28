import { NextResponse } from 'next/server';
import fs from 'fs';
import { getDatasetsRoot } from '@/server/settings';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { imgPath } = body;
    let datasetsPath = await getDatasetsRoot();
    
    // Check if this file is from a linked dataset (external path)
    let isFromLinkedDataset = false;
    
    if (!imgPath.startsWith(datasetsPath)) {
      // Check if it's from a linked dataset
      try {
        const linkedDatasets = await prisma.dataset.findMany({
          where: { type: 'linked' }
        });
        
        isFromLinkedDataset = linkedDatasets.some(dataset => 
          dataset.external_path && imgPath.startsWith(dataset.external_path)
        );
        
        if (!isFromLinkedDataset) {
          return NextResponse.json({ error: 'Invalid image path' }, { status: 400 });
        }
      } catch (error) {
        console.error('Error checking linked datasets:', error);
        return NextResponse.json({ error: 'Invalid image path' }, { status: 400 });
      }
    }
    
    // Prevent deletion of files from external/linked datasets
    if (isFromLinkedDataset) {
      return NextResponse.json({ 
        error: 'Cannot delete files from linked datasets. Files in external paths are protected.' 
      }, { status: 403 });
    }

    // if img doesnt exist, ignore
    if (!fs.existsSync(imgPath)) {
      return NextResponse.json({ success: true });
    }

    // delete it and return success
    fs.unlinkSync(imgPath);

    // check for caption
    const captionPath = imgPath.replace(/\.[^/.]+$/, '') + '.txt';
    if (fs.existsSync(captionPath)) {
      // delete caption file
      fs.unlinkSync(captionPath);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create dataset' }, { status: 500 });
  }
}
