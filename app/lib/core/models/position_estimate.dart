/// Position estimate model used by the client-side positioning system.
///
/// Represents a player's estimated position in world coordinates.
/// The server validates and stores these; the client uses them for
/// local rendering (own position on the map).
library;

/// The source technology that produced this position estimate.
enum PositionSource {
  imu,
  gps,
  ble,
  wifi,
  uwb,
  ar,
  fused,
  manualDebug;

  String toWire() => name.toUpperCase();

  static PositionSource fromWire(String? value) {
    return PositionSource.values.firstWhere(
      (e) => e.name.toUpperCase() == (value ?? '').toUpperCase(),
      orElse: () => PositionSource.fused,
    );
  }
}

/// A single position estimate in world coordinates.
class PositionEstimate {
  const PositionEstimate({
    required this.x,
    required this.y,
    this.heading,
    this.confidence = 0.5,
    this.source = PositionSource.fused,
    required this.timestamp,
    this.roomId,
    this.onCorridor = false,
  });

  final double x;
  final double y;

  /// Heading in degrees (0–360), null if unknown.
  final double? heading;

  /// Confidence 0.0–1.0.
  final double confidence;

  /// Source technology.
  final PositionSource source;

  /// Server timestamp (epoch ms).
  final int timestamp;

  /// Current room ID computed by the server (null if on corridor).
  final String? roomId;

  /// Whether the position was snapped to a corridor by map matching.
  final bool onCorridor;

  PositionEstimate copyWith({
    double? x,
    double? y,
    double? heading,
    double? confidence,
    PositionSource? source,
    int? timestamp,
    String? roomId,
    bool? onCorridor,
  }) {
    return PositionEstimate(
      x: x ?? this.x,
      y: y ?? this.y,
      heading: heading ?? this.heading,
      confidence: confidence ?? this.confidence,
      source: source ?? this.source,
      timestamp: timestamp ?? this.timestamp,
      roomId: roomId ?? this.roomId,
      onCorridor: onCorridor ?? this.onCorridor,
    );
  }

  /// Creates a position from a server-confirmed payload.
  factory PositionEstimate.fromServer(Map<String, dynamic> data) {
    return PositionEstimate(
      x: (data['x'] as num?)?.toDouble() ?? 0,
      y: (data['y'] as num?)?.toDouble() ?? 0,
      heading: (data['heading'] as num?)?.toDouble(),
      confidence: (data['confidence'] as num?)?.toDouble() ?? 0.5,
      source: PositionSource.fromWire(data['source'] as String?),
      timestamp: data['timestamp'] is num
          ? (data['timestamp'] as num).toInt()
          : DateTime.now().millisecondsSinceEpoch,
      roomId: data['roomId'] as String?,
      onCorridor: data['onCorridor'] as bool? ?? false,
    );
  }

  /// Serializes for sending to the server.
  Map<String, dynamic> toPayload() => {
        'x': x,
        'y': y,
        if (heading != null) 'heading': heading,
        'confidence': confidence,
        'source': source.toWire(),
      };

  @override
  String toString() =>
      'Pos(${x.toStringAsFixed(1)}, ${y.toStringAsFixed(1)}, '
      'h=${heading?.toStringAsFixed(0) ?? "?"}, '
      'c=${confidence.toStringAsFixed(2)}, '
      'src=${source.name})';
}
