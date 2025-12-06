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

      // Source files
      const moduleSource = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', 'com', 'proofpix', 'app', 'ImageCompositorModule.kt');
      const packageSource = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', 'com', 'proofpix', 'app', 'ImageCompositorPackage.kt');

      // Destination
      const destDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'java', 'com', 'proofpix', 'app');
      const moduleDest = path.join(destDir, 'ImageCompositorModule.kt');
      const packageDest = path.join(destDir, 'ImageCompositorPackage.kt');

      try {
        // Ensure destination directory exists
        await fs.mkdir(destDir, { recursive: true });

        // Copy Module file
        const moduleContent = await fs.readFile(moduleSource, 'utf8');
        await fs.writeFile(moduleDest, moduleContent);
        console.log(`✅ Copied ImageCompositorModule.kt to ${moduleDest}`);

        // Copy Package file
        const packageContent = await fs.readFile(packageSource, 'utf8');
        await fs.writeFile(packageDest, packageContent);
        console.log(`✅ Copied ImageCompositorPackage.kt to ${packageDest}`);
      } catch (error) {
        console.error('❌ Error copying ImageCompositor Android files:', error);
      }

      return config;
    },
  ]);

  // Android: Register package in MainApplication.kt
  config = withMainApplication(config, (config) => {
    const mainApplication = config.modResults;
    const packageName = 'ImageCompositorPackage';
    const packageImport = 'com.proofpix.app.ImageCompositorPackage';

    // Check if already registered
    if (mainApplication.contents.includes(packageName)) {
      console.log(`✅ ${packageName} already registered in MainApplication.kt`);
      return config;
    }

    // Add the package to the getPackages() method
    const packagesPattern = /PackageList\(this\)\.packages\.apply\s*\{([^}]*)\}/s;
    const match = mainApplication.contents.match(packagesPattern);

    if (match) {
      const packagesBlock = match[1];
      // Add our package after existing add() calls
      const updatedPackagesBlock = packagesBlock + `\n              add(${packageName}())`;
      mainApplication.contents = mainApplication.contents.replace(
        packagesPattern,
        `PackageList(this).packages.apply {${updatedPackagesBlock}}`
      );
      console.log(`✅ Registered ${packageName} in MainApplication.kt`);
    } else {
      console.error('❌ Could not find packages block in MainApplication.kt');
    }

    return config;
  });

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
