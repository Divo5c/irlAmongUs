/// Catalog of game functions a real room can have on the map.
///
/// Mirrors shared/models/enums.schema.json ($defs.RoomType).
/// These are metadata for now — special mechanics per type come later.
library;

import 'package:flutter/material.dart';

const List<String> kRoomTypes = [
  'NORMAL',
  'CAFETERIA',
  'MEDBAY',
  'SECURITY',
  'REACTOR',
  'ELECTRICAL',
  'STORAGE',
  'ADMIN',
  'O2',
  'WEAPONS',
];

/// Human readable label for a room type.
String roomTypeLabel(String type) {
  switch (type) {
    case 'NORMAL':
      return 'Normal';
    case 'CAFETERIA':
      return 'Cafeteria';
    case 'MEDBAY':
      return 'MedBay';
    case 'SECURITY':
      return 'Security';
    case 'REACTOR':
      return 'Reactor';
    case 'ELECTRICAL':
      return 'Electrical';
    case 'STORAGE':
      return 'Storage';
    case 'ADMIN':
      return 'Admin';
    case 'O2':
      return 'O2';
    case 'WEAPONS':
      return 'Weapons';
    default:
      return type;
  }
}

/// Icon for map labels and lists.
IconData roomTypeIcon(String type) {
  switch (type) {
    case 'CAFETERIA':
      return Icons.restaurant_rounded;
    case 'MEDBAY':
      return Icons.medical_services_rounded;
    case 'SECURITY':
      return Icons.videocam_rounded;
    case 'REACTOR':
      return Icons.bolt_rounded;
    case 'ELECTRICAL':
      return Icons.electrical_services_rounded;
    case 'STORAGE':
      return Icons.inventory_2_rounded;
    case 'ADMIN':
      return Icons.badge_rounded;
    case 'O2':
      return Icons.air_rounded;
    case 'WEAPONS':
      return Icons.gps_fixed_rounded;
    default:
      return Icons.meeting_room_rounded;
  }
}

/// Stable color mapping for map rendering.
Color roomTypeColor(String type, ColorScheme scheme) {
  switch (type) {
    case 'CAFETERIA':
      return const Color(0xFF26A69A);
    case 'MEDBAY':
      return const Color(0xFF66BB6A);
    case 'SECURITY':
      return const Color(0xFF42A5F5);
    case 'REACTOR':
      return const Color(0xFFFF7043);
    case 'ELECTRICAL':
      return const Color(0xFFFDD835);
    case 'STORAGE':
      return const Color(0xFF8D6E63);
    case 'ADMIN':
      return const Color(0xFFAB47BC);
    case 'O2':
      return const Color(0xFF4DD0E1);
    case 'WEAPONS':
      return const Color(0xFFEF5350);
    default:
      return scheme.secondaryContainer;
  }
}
