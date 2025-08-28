import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  { params }: { params: { datasetName: string } }
) {
  try {
    const { datasetName } = await params;
    
    const dataset = await prisma.dataset.findUnique({
      where: { name: datasetName }
    });

    if (!dataset) {
      return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
    }

    return NextResponse.json({
      caption_format: dataset.caption_format,
      json_attribute: dataset.json_attribute,
    });
  } catch (error) {
    console.error('Error fetching dataset config:', error);
    return NextResponse.json({ error: 'Failed to fetch dataset config' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { datasetName: string } }
) {
  try {
    const { datasetName } = await params;
    const body = await request.json();
    const { caption_format, json_attribute } = body;

    const dataset = await prisma.dataset.findUnique({
      where: { name: datasetName }
    });

    if (!dataset) {
      return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
    }

    const updatedDataset = await prisma.dataset.update({
      where: { name: datasetName },
      data: {
        caption_format: caption_format || dataset.caption_format,
        json_attribute: json_attribute || dataset.json_attribute,
      }
    });

    return NextResponse.json({
      success: true,
      caption_format: updatedDataset.caption_format,
      json_attribute: updatedDataset.json_attribute,
    });
  } catch (error) {
    console.error('Error updating dataset config:', error);
    return NextResponse.json({ error: 'Failed to update dataset config' }, { status: 500 });
  }
}