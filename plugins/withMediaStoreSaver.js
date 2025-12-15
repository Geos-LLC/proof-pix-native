const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs').promises;
const path = require('path');

/**
 * This plugin copies the MediaStoreSaver native module files into the Android project
 * and registers the package in MainApplication.kt
 */
const withMediaStoreSaver = (config) => {
  // Copy the files for Android
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformProjectRoot = config.modRequest.platformProjectRoot;

      // Source files in the modules/media-store-saver directory
      const moduleSource = path.join(projectRoot, 'modules', 'media-store-saver', 'MediaStoreSaverModule.kt');
      const packageSource = path.join(projectRoot, 'modules', 'media-store-saver', 'MediaStoreSaverPackage.kt');

      // Destination in the Android project directory
      const appName = config.modRequest.projectName || 'proofpixnative';
      const destDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'java', 'com', 'proofpix', 'app');
      const moduleDest = path.join(destDir, 'MediaStoreSaverModule.kt');
      const packageDest = path.join(destDir, 'MediaStoreSaverPackage.kt');
      const mainApplicationPath = path.join(destDir, 'MainApplication.kt');

      try {
        // Ensure destination directory exists
        await fs.mkdir(destDir, { recursive: true });

        // Copy MediaStoreSaverModule.kt
        const moduleContent = await fs.readFile(moduleSource, 'utf8');
        await fs.writeFile(moduleDest, moduleContent);
        console.log(`✅ Copied MediaStoreSaverModule.kt to ${moduleDest}`);

        // Copy MediaStoreSaverPackage.kt
        const packageContent = await fs.readFile(packageSource, 'utf8');
        await fs.writeFile(packageDest, packageContent);
        console.log(`✅ Copied MediaStoreSaverPackage.kt to ${packageDest}`);

        // Modify MainApplication.kt to register the package
        let mainAppContent = await fs.readFile(mainApplicationPath, 'utf8');

        // Check if MediaStoreSaverPackage is already registered
        if (!mainAppContent.includes('MediaStoreSaverPackage()')) {
          let modified = false;

          // Try different patterns to find where to add the package
          // Pattern 1: Look for ImageCompositorPackage
          if (mainAppContent.includes('ImageCompositorPackage()')) {
            mainAppContent = mainAppContent.replace(
              /(\s+add\(ImageCompositorPackage\(\)\))/,
              '$1\n              add(MediaStoreSaverPackage())'
            );
            modified = true;
          }
          // Pattern 2: Look for PackageList(this).packages.apply { with any content before first add or }
          else if (mainAppContent.includes('PackageList(this).packages.apply')) {
            // Match the opening of the apply block and add right after the opening brace
            mainAppContent = mainAppContent.replace(
              /(PackageList\(this\)\.packages\.apply\s*\{)/,
              '$1\n              add(MediaStoreSaverPackage())'
            );
            modified = true;
          }
          // Pattern 3: Look for PackageList(this).packages (without apply) - older format
          else if (mainAppContent.includes('PackageList(this).packages')) {
            mainAppContent = mainAppContent.replace(
              /(PackageList\(this\)\.packages)/,
              '$1.apply { add(MediaStoreSaverPackage()) }'
            );
            modified = true;
          }

          if (modified) {
            await fs.writeFile(mainApplicationPath, mainAppContent);
            console.log(`✅ Registered MediaStoreSaverPackage in MainApplication.kt`);
          } else {
            console.error(`❌ Could not find suitable location to add MediaStoreSaverPackage`);
          }
        } else {
          console.log(`ℹ️  MediaStoreSaverPackage already registered in MainApplication.kt`);
        }
      } catch (error) {
        console.error('❌ Error setting up MediaStoreSaver:', error);
      }

      return config;
    },
  ]);

  return config;
};

module.exports = withMediaStoreSaver;
