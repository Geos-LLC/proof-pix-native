import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

export const CroppedThumbnail = ({ imageUri, aspectRatio = '4:3', orientation = 'portrait', size = 120 }) => {
  // Show full photo covering the entire container
  return (
    <View style={[styles.thumbnailContainer, { width: size, height: 238 }]}>
      <Image 
        key={imageUri}
        source={{ uri: imageUri }} 
        style={{ width: size, height: 238 }} 
        resizeMode="cover" 
      />
    </View>
  );
};

const styles = StyleSheet.create({
  thumbnailContainer: {
    backgroundColor: '#000',
    borderRadius: 8,
    overflow: 'hidden'
  }
  
});
