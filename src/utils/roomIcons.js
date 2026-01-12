import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/rooms';

// Map room IDs to icon names
export const getRoomIcon = (roomId) => {
  const iconMap = {
    'kitchen': { name: 'restaurant', library: 'Ionicons' },
    'bathroom': { name: 'water', library: 'Ionicons' },
    'bedroom': { name: 'bed', library: 'Ionicons' },
    'living-room': { name: 'home', library: 'Ionicons' },
    'dining-room': { name: 'restaurant-outline', library: 'Ionicons' },
    'office': { name: 'briefcase', library: 'Ionicons' },
  };
  
  return iconMap[roomId] || { name: 'camera', library: 'Ionicons' };
};

// Component to render room icon
export const RoomIcon = ({ roomId, size = 24, color = COLORS.TEXT, style }) => {
  const icon = getRoomIcon(roomId);
  
  switch (icon.library) {
    case 'Ionicons':
      return <Ionicons name={icon.name} size={size} color={color} style={style} />;
    default:
      return <Ionicons name="camera" size={size} color={color} style={style} />;
  }
};

