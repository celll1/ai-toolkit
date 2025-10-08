import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
const CAPTION_EXTENSIONS = ['.txt', '.caption', '.json'];

interface RandomCaptionResult {
  caption: string;
  imagePath?: string;
  controlImagePath?: string;
}

function getRandomCaption(
  datasetPath: string,
  datasetConfig?: {
    paired_files?: boolean;
    source_suffix?: string;
    target_suffix?: string;
    instruction_suffix?: string;
    control_path?: string;
    caption_ext?: string;
  }
): RandomCaptionResult | null {
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
    let randomImagePath = imageFiles[Math.floor(Math.random() * imageFiles.length)];
    let imageBaseName = path.parse(randomImagePath).name;
    let imageDir = path.dirname(randomImagePath);

    // For paired files mode, filter to target files only
    if (datasetConfig?.paired_files && datasetConfig.target_suffix) {
      const targetFiles = imageFiles.filter(file => {
        const name = path.parse(file).name;
        return name.includes(datasetConfig.target_suffix);
      });

      if (targetFiles.length > 0) {
        randomImagePath = targetFiles[Math.floor(Math.random() * targetFiles.length)];
        imageBaseName = path.parse(randomImagePath).name;
        imageDir = path.dirname(randomImagePath);
      }
    }

    console.log(`[Random Caption] Selected image: ${randomImagePath}`);
    console.log(`[Random Caption] Image base name: ${imageBaseName}`);
    console.log(`[Random Caption] Paired files mode: ${datasetConfig?.paired_files}`);
    if (datasetConfig?.paired_files) {
      console.log(`[Random Caption] Target suffix: ${datasetConfig.target_suffix}`);
      console.log(`[Random Caption] Instruction suffix: ${datasetConfig.instruction_suffix}`);
    }

    // Find control image
    let controlImagePath: string | undefined;

    if (datasetConfig?.paired_files && datasetConfig.source_suffix && datasetConfig.target_suffix) {
      // Paired files mode: replace target suffix with source suffix
      const sourceName = imageBaseName.replace(datasetConfig.target_suffix, datasetConfig.source_suffix);
      for (const ext of IMAGE_EXTENSIONS) {
        const sourceImagePath = path.join(imageDir, sourceName + ext);
        if (fs.existsSync(sourceImagePath)) {
          controlImagePath = sourceImagePath;
          console.log(`[Random Caption] Found paired control image: ${controlImagePath}`);
          break;
        }
      }
    } else if (datasetConfig?.control_path) {
      // Separate control_path mode
      for (const ext of IMAGE_EXTENSIONS) {
        const controlPath = path.join(datasetConfig.control_path, imageBaseName + ext);
        if (fs.existsSync(controlPath)) {
          controlImagePath = controlPath;
          console.log(`[Random Caption] Found control image: ${controlImagePath}`);
          break;
        }
      }
    }

    // Look for corresponding caption file
    let captionBaseName = imageBaseName;

    // For paired files, replace target suffix with instruction suffix
    if (datasetConfig?.paired_files && datasetConfig.instruction_suffix && datasetConfig.target_suffix) {
      captionBaseName = imageBaseName.replace(datasetConfig.target_suffix, datasetConfig.instruction_suffix);
      console.log(`[Random Caption] Caption base name (after suffix replacement): ${captionBaseName}`);
    } else {
      console.log(`[Random Caption] Caption base name: ${captionBaseName}`);
    }

    // Determine which caption extensions to try
    let captionExtensions = CAPTION_EXTENSIONS;
    if (datasetConfig?.caption_ext) {
      // Ensure extension starts with a dot
      const ext = datasetConfig.caption_ext.startsWith('.')
        ? datasetConfig.caption_ext
        : '.' + datasetConfig.caption_ext;
      captionExtensions = [ext, ...CAPTION_EXTENSIONS]; // Try configured first, then fall back
    }

    console.log(`[Random Caption] Looking for caption with extensions: ${captionExtensions.join(', ')}`);

    for (const captionExt of captionExtensions) {
      const captionPath = path.join(imageDir, captionBaseName + captionExt);
      console.log(`[Random Caption] Trying caption path: ${captionPath}`);
      
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
              return {
                caption: caption.trim(),
                imagePath: randomImagePath,
                controlImagePath
              };
            }
          }
        } catch (error) {
          console.error(`Error reading caption file ${captionPath}:`, error);
        }
      }
    }
    
    // If no caption file found, return the image filename without extension as fallback
    console.log(`[Random Caption] No caption file found, using filename as fallback: ${captionBaseName}`);
    return {
      caption: captionBaseName.replace(/[_-]/g, ' '),
      imagePath: randomImagePath,
      controlImagePath
    };
    
  } catch (error) {
    console.error(`Error getting random caption from ${datasetPath}:`, error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { datasetName, datasetConfig } = await request.json();

    console.log(`[Random Caption] Requested dataset: ${datasetName}`);
    console.log(`[Random Caption] Dataset config:`, datasetConfig);

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
    
    const result = getRandomCaption(datasetPath, datasetConfig);

    if (!result) {
      return NextResponse.json({ error: 'No captions found in dataset' }, { status: 404 });
    }

    return NextResponse.json(result);
    
  } catch (error) {
    console.error('Error fetching random caption:', error);
    return NextResponse.json({ error: 'Failed to fetch random caption' }, { status: 500 });
  }
}