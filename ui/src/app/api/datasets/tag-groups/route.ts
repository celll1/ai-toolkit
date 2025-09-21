import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const tagGroupDir = searchParams.get('dir') || 'taggroup';
    
    // Build the full path
    const fullPath = path.isAbsolute(tagGroupDir) 
      ? tagGroupDir 
      : path.join(process.cwd(), tagGroupDir);
    
    // Check if directory exists
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ 
        groups: [],
        error: `Directory not found: ${tagGroupDir}`
      });
    }
    
    // Read all JSON files in the directory
    const files = fs.readdirSync(fullPath)
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''));
    
    // Common tag group names to prioritize
    const commonGroups = ['Character', 'General', 'Artist', 'Copyright', 'Meta', 'Quality', 'Rating', 'Model'];
    
    // Sort: common groups first (in defined order), then alphabetically
    const sortedGroups = [
      ...commonGroups.filter(g => files.includes(g)),
      ...files.filter(f => !commonGroups.includes(f)).sort()
    ];
    
    return NextResponse.json({ groups: sortedGroups });
  } catch (error) {
    console.error('Error reading tag groups:', error);
    return NextResponse.json({ 
      groups: [],
      error: 'Failed to read tag groups'
    }, { status: 500 });
  }
}