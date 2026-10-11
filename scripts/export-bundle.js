const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 1. Root & Directory Paths
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'ai_coder_conv');
const PKG_PATH = path.join(ROOT_DIR, 'package.json');

// 2. Load Config from package.json with graceful defaults
let retentionDays = 30;
let targetFolders = ['assets'];
let includeRootFiles = true;
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff'];


if (fs.existsSync(PKG_PATH)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
    if (pkg.bundleConfig) {
      if (typeof pkg.bundleConfig.retentionDays === 'number') {
        retentionDays = pkg.bundleConfig.retentionDays;
      }
      if (Array.isArray(pkg.bundleConfig.targetFolders)) {
        targetFolders = pkg.bundleConfig.targetFolders;
      }
      if (typeof pkg.bundleConfig.includeRootFiles === 'boolean') {
        includeRootFiles = pkg.bundleConfig.includeRootFiles;
      }
    }
  } catch (err) {
    console.warn('⚠️ Warning: Could not parse package.json for bundleConfig:', err.message);
  }
}

// 3. Format Date / Timestamp (YYYY-MM-DD HH-mm) - 24-hour military time
function getTimestampString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day} ${hours}-${minutes}`;
}

// 4. Get truncated commit message (max 50 characters)
function getTruncatedCommitMessage() {
  try {
    // Get the latest commit message
    const commitMessage = execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim();
    
    // Truncate to 50 characters and remove newlines
    const truncated = commitMessage.replace(/\n/g, ' ').substring(0, 50);
    
    // Clean up the message (remove special characters that might cause issues in filenames)
    return truncated.replace(/[^\w\s-]/g, '').trim();
  } catch (err) {
    console.warn('⚠️ Could not get commit message, using default:', err.message);
    return 'no-commit-msg';
  }
}

// 4. Recursively collect all files from a directory
function collectFilesFromDir(dirPath) {
  let results = [];
  if (!fs.existsSync(dirPath)) return results;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (['.venv', '.git', 'ai_coder_conv', 'node_modules', 'scripts'].includes(entry.name)) {
      continue;
    }
    if (entry.isDirectory()) {
      results = results.concat(collectFilesFromDir(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

// Map file extension to markdown syntax highlighting language
function getMarkdownLang(ext) {
  switch (ext.toLowerCase()) {
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.ts':
      return 'typescript';
    case '.html':
    case '.htm':
      return 'html';
    case '.json':
      return 'json';
    case '.css':
      return 'css';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.py':
      return 'python';
    case '.sql':
      return 'sql';
    case '.sh':
    case '.bash':
      return 'bash';
    case '.md':
      return 'markdown';
    default:
      return 'text';
  }
}

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 5. Cleanup bundles older than retentionDays
function cleanOldBundles() {
  if (retentionDays <= 0) return;

  const now = Date.now();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(OUTPUT_DIR)) return;
  const files = fs.readdirSync(OUTPUT_DIR);

  let cleanedCount = 0;
  files.forEach((file) => {
    if (file.startsWith('_code-bundle') && (file.endsWith('.md') || file.endsWith('.txt'))) {
      const filePath = path.join(OUTPUT_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      } catch (err) {
        console.warn('⚠️ Could not stat file for cleanup:', filePath, err.message);
      }
    }
  });

  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned ${cleanedCount} old bundle(s) older than ${retentionDays} days`);
  }
}

// 6. Generate the code bundle
function generateBundle() {
  const timestamp = getTimestampString();
  const commitMessage = getTruncatedCommitMessage();
  const outputFileName = `_code-bundle ${timestamp} = ${commitMessage}.md`;
  const outputPath = path.join(OUTPUT_DIR, outputFileName);
  
  console.log(`📦 [QB Store Code Bundler] Packaging project files (excluding image contents)...`);
  console.log(`⚙️  Retention configuration: ${retentionDays} days`);
  console.log(`📝 Commit message: ${commitMessage}`);

  let allFilePaths = [];

  // Collect from target folders
  targetFolders.forEach((folder) => {
    const fullDirPath = path.join(ROOT_DIR, folder);
    const files = collectFilesFromDir(fullDirPath);
    allFilePaths = allFilePaths.concat(files);
  });

  // Collect root source files if enabled
  if (includeRootFiles) {
    const rootEntries = fs.readdirSync(ROOT_DIR, { withFileTypes: true });
    rootEntries.forEach((entry) => {
      if (entry.isFile()) {
        const fileName = entry.name;
        if (fileName === '.env' || fileName.startsWith('_code-bundle')) return;
        const ext = path.extname(fileName).toLowerCase();
        if (['.html', '.py', '.json', '.md', '.txt', '.yml', '.yaml', '.css', '.js', '.example', '.gitignore', '.env.example'].includes(ext) || fileName === 'CNAME' || IMAGE_EXTENSIONS.includes(ext)) {
          allFilePaths.push(path.join(ROOT_DIR, fileName));
        }
      }
    });
  }

  // Deduplicate file paths
  allFilePaths = [...new Set(allFilePaths)];

  // Convert to relative paths with normalized forward slashes
  const relativeFilePaths = allFilePaths.map((fp) => path.relative(ROOT_DIR, fp).replace(/\\/g, '/')).sort();

  let bundleContent = `# EBay-To-GitHub-Pages-Store - Source Code Bundle\n`;
  bundleContent += `**Generated:** ${timestamp}\n`;
  bundleContent += `**Commit Message:** ${commitMessage}\n`;
  bundleContent += `**Total Included Files:** ${relativeFilePaths.length}\n\n`;

  // Separate text files and image files for manifest clarity
  const textFiles = relativeFilePaths.filter(p => !IMAGE_EXTENSIONS.includes(path.extname(p).toLowerCase()));
  const imageFiles = relativeFilePaths.filter(p => IMAGE_EXTENSIONS.includes(path.extname(p).toLowerCase()));

  bundleContent += `## 📋 Included Files Manifest\n\n`;
  bundleContent += `### Code & Configuration Files (${textFiles.length})\n`;
  textFiles.forEach((relPath, idx) => {
    bundleContent += `${idx + 1}. \`${relPath}\`\n`;
  });

  if (imageFiles.length > 0) {
    bundleContent += `\n### Asset Image Files (Manifest Only - Contents Excluded) (${imageFiles.length})\n`;
    imageFiles.forEach((relPath, idx) => {
      bundleContent += `${idx + 1}. \`${relPath}\`\n`;
    });
  }
  bundleContent += `\n---\n\n`;

  let bundledCount = 0;
  relativeFilePaths.forEach((relPath) => {
    const fullPath = path.join(ROOT_DIR, relPath);
    if (!fs.existsSync(fullPath)) return;

    const ext = path.extname(relPath).toLowerCase();

    // Skip content dump for image/binary files
    if (IMAGE_EXTENSIONS.includes(ext)) {
      return;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const lang = getMarkdownLang(ext);

    bundleContent += `// ============================================================================\n`;
    bundleContent += `// FILE: ${relPath}\n`;
    bundleContent += `// ============================================================================\n\n`;
    bundleContent += `\`\`\`${lang}\n`;
    bundleContent += `${content}\n`;
    bundleContent += `\`\`\`\n\n`;

    bundledCount++;
  });

  fs.writeFileSync(outputPath, bundleContent, 'utf8');
  console.log(`✅ Bundle created successfully: ai_coder_conv/${outputFileName} (${bundledCount} text files bundled, ${imageFiles.length} image files in manifest)`);

  // Run cleanup
  cleanOldBundles();
}

generateBundle();

