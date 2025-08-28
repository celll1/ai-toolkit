import { NextResponse } from 'next/server';
import fs from 'fs';
import { getDatasetsRoot } from '@/server/settings';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { imgPath, caption } = body;
    let datasetsPath = await getDatasetsRoot();
    
    // Check if the image path is in dataset root or external linked dataset paths
    let isValidPath = imgPath.startsWith(datasetsPath);
    
    if (!isValidPath) {
      // Check if it's from a linked dataset
      try {
        const linkedDatasets = await prisma.dataset.findMany({
          where: { type: 'linked' }
        });
        
        isValidPath = linkedDatasets.some(dataset => 
          dataset.external_path && imgPath.startsWith(dataset.external_path)
        );
      } catch (error) {
        console.error('Error checking linked datasets:', error);
      }
    }
    
    if (!isValidPath) {
      return NextResponse.json({ error: 'Invalid image path' }, { status: 400 });
    }

    // if img doesnt exist, ignore
    if (!fs.existsSync(imgPath)) {
      return NextResponse.json({ error: 'Image does not exist' }, { status: 404 });
    }

    // check for caption
    const captionPath = imgPath.replace(/\.[^/.]+$/, '') + '.txt';
    // save caption to file
    fs.writeFileSync(captionPath, caption);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create dataset' }, { status: 500 });
  }
}
