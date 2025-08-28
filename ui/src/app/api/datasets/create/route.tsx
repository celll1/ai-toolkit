import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let { name, type = 'local', externalPath } = body;
    
    // clean name by making lower case,  removing special characters, and replacing spaces with underscores
    name = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');

    let datasetsPath = await getDatasetsRoot();
    let datasetPath = path.join(datasetsPath, name);

    if (type === 'linked') {
      // For linked datasets, verify the external path exists
      if (!externalPath || !fs.existsSync(externalPath)) {
        return NextResponse.json({ error: 'External path does not exist' }, { status: 400 });
      }

      // Create a working directory for cache only
      const cacheDir = path.join(datasetPath, '.cache');
      if (!fs.existsSync(datasetPath)) {
        fs.mkdirSync(datasetPath, { recursive: true });
      }
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // Store the dataset info in database
      await prisma.dataset.create({
        data: {
          name,
          type: 'linked',
          external_path: externalPath,
        },
      });

      // Create a marker file to indicate this is a linked dataset
      fs.writeFileSync(
        path.join(datasetPath, '.linked'),
        JSON.stringify({ 
          externalPath,
          createdAt: new Date().toISOString()
        })
      );

    } else {
      // For local datasets, create the folder normally
      if (!fs.existsSync(datasetPath)) {
        fs.mkdirSync(datasetPath);
      }

      // Store in database
      await prisma.dataset.create({
        data: {
          name,
          type: 'local',
        },
      });
    }

    return NextResponse.json({ success: true, name: name, type });
  } catch (error) {
    console.error('Error creating dataset:', error);
    return NextResponse.json({ error: 'Failed to create dataset' }, { status: 500 });
  }
}
