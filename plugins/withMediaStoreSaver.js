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
          // Find the getPackages() method and add the package
          // Look for the ImageCompositorPackage line as a reference point
          if (mainAppContent.includes('ImageCompositorPackage()')) {
            // Add after ImageCompositorPackage
            mainAppContent = mainAppContent.replace(
              /(\s+add\(ImageCompositorPackage\(\)\))/,
              '$1\n              add(MediaStoreSaverPackage())'
            );
          } else {
            // Add after PackageList if ImageCompositor not found
            mainAppContent = mainAppContent.replace(
              /(PackageList\(this\)\.packages\.apply\s*\{[^}]*?\/\/[^\n]*\n)/,
              '$1              add(MediaStoreSaverPackage())\n'
            );
          }

          await fs.writeFile(mainApplicationPath, mainAppContent);
          console.log(`✅ Registered MediaStoreSaverPackage in MainApplication.kt`);
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
