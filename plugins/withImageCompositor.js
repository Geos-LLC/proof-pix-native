const { withDangerousMod, withXcodeProject, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs').promises;
const path = require('path');

/**
 * This plugin copies the ImageCompositor native module files into both iOS and Android projects
 */
const withImageCompositor = (config) => {
  // iOS: Copy Swift and Objective-C files
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformProjectRoot = config.modRequest.platformProjectRoot;

      // Source files in the modules/image-compositor directory
      const swiftSource = path.join(projectRoot, 'modules', 'image-compositor', 'ImageCompositor.swift');
      const objcSource = path.join(projectRoot, 'modules', 'image-compositor', 'ImageCompositor.m');

      // Destination in the iOS project directory
      const appName = config.modRequest.projectName || 'proofpixnative';
      const destDir = path.join(platformProjectRoot, appName);
      const swiftDest = path.join(destDir, 'ImageCompositor.swift');
      const objcDest = path.join(destDir, 'ImageCompositor.m');

      try {
        // Ensure destination directory exists
        await fs.mkdir(destDir, { recursive: true });

        // Copy Swift file
        const swiftContent = await fs.readFile(swiftSource, 'utf8');
        await fs.writeFile(swiftDest, swiftContent);
        console.log(`✅ Copied ImageCompositor.swift to ${swiftDest}`);

        // Copy Objective-C bridge file
        const objcContent = await fs.readFile(objcSource, 'utf8');
        await fs.writeFile(objcDest, objcContent);
        console.log(`✅ Copied ImageCompositor.m to ${objcDest}`);
      } catch (error) {
        console.error('❌ Error copying ImageCompositor files:', error);
      }

      return config;
    },
  ]);

  // Android: Copy Kotlin files
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformProjectRoot = config.modRequest.platformProjectRoot;

      // Source files in the modules/image-compositor directory
      const moduleSource = path.join(projectRoot, 'modules', 'image-compositor', 'ImageCompositorModule.kt');
      const packageSource = path.join(projectRoot, 'modules', 'image-compositor', 'ImageCompositorPackage.kt');

      // Destination in the Android project directory
      const destDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'java', 'com', 'proofpix', 'app');
      const moduleDest = path.join(destDir, 'ImageCompositorModule.kt');
      const packageDest = path.join(destDir, 'ImageCompositorPackage.kt');
      const mainApplicationPath = path.join(destDir, 'MainApplication.kt');

      try {
        // Ensure destination directory exists
        await fs.mkdir(destDir, { recursive: true });

        // Copy ImageCompositorModule.kt
        const moduleContent = await fs.readFile(moduleSource, 'utf8');
        await fs.writeFile(moduleDest, moduleContent);
        console.log(`✅ Copied ImageCompositorModule.kt to ${moduleDest}`);

        // Copy ImageCompositorPackage.kt
        const packageContent = await fs.readFile(packageSource, 'utf8');
        await fs.writeFile(packageDest, packageContent);
        console.log(`✅ Copied ImageCompositorPackage.kt to ${packageDest}`);

        // Modify MainApplication.kt to register the package
        let mainAppContent = await fs.readFile(mainApplicationPath, 'utf8');

        // Check if ImageCompositorPackage is already registered
        if (!mainAppContent.includes('ImageCompositorPackage()')) {
          let modified = false;

          // Try different patterns to find where to add the package
          // Pattern 1: Look for MediaStoreSaverPackage
          if (mainAppContent.includes('MediaStoreSaverPackage()')) {
            mainAppContent = mainAppContent.replace(
              /(\s+add\(MediaStoreSaverPackage\(\)\))/,
              '$1\n              add(ImageCompositorPackage())'
            );
            modified = true;
          }
          // Pattern 2: Look for PackageList(this).packages.apply { with any content before first add or }
          else if (mainAppContent.includes('PackageList(this).packages.apply')) {
            // Match the opening of the apply block and add right after the opening brace
            mainAppContent = mainAppContent.replace(
              /(PackageList\(this\)\.packages\.apply\s*\{)/,
              '$1\n              add(ImageCompositorPackage())'
            );
            modified = true;
          }
          // Pattern 3: Look for PackageList(this).packages (without apply) - older format
          else if (mainAppContent.includes('PackageList(this).packages')) {
            mainAppContent = mainAppContent.replace(
              /(PackageList\(this\)\.packages)/,
              '$1.apply { add(ImageCompositorPackage()) }'
            );
            modified = true;
          }

          if (modified) {
            await fs.writeFile(mainApplicationPath, mainAppContent);
            console.log(`✅ Registered ImageCompositorPackage in MainApplication.kt`);
          } else {
            console.error(`❌ Could not find suitable location to add ImageCompositorPackage`);
          }
        } else {
          console.log(`ℹ️  ImageCompositorPackage already registered in MainApplication.kt`);
        }
      } catch (error) {
        console.error('❌ Error setting up ImageCompositor:', error);
      }

      return config;
    },
  ]);

  // iOS: Add files to Xcode project
  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const appName = config.modRequest.projectName || 'proofpixnative';

    // Add Swift file with correct path relative to iOS project
    const swiftPath = `${appName}/ImageCompositor.swift`;
    if (!xcodeProject.hasFile(swiftPath)) {
      xcodeProject.addSourceFile(
        swiftPath,
        {},
        xcodeProject.findPBXGroupKey({ name: appName })
      );
      console.log(`✅ Added ${swiftPath} to Xcode project`);
    }

    // Add Objective-C bridge file with correct path
    const objcPath = `${appName}/ImageCompositor.m`;
    if (!xcodeProject.hasFile(objcPath)) {
      xcodeProject.addSourceFile(
        objcPath,
        {},
        xcodeProject.findPBXGroupKey({ name: appName })
      );
      console.log(`✅ Added ${objcPath} to Xcode project`);
    }

    return config;
  });

  return config;
};

module.exports = withImageCompositor;
