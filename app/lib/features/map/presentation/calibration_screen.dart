/// Calibration screen for step length estimation.
///
/// Guides the user through a walk to calibrate the PDR engine's
/// step length factor. The user walks a known distance (e.g., 10m)
/// and the system counts steps to compute stride length.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:real_life_amongus_app/core/positioning/calibration_service.dart';
import 'package:real_life_amongus_app/core/positioning/sensor_provider.dart';

class CalibrationScreen extends StatefulWidget {
  const CalibrationScreen({
    required this.sensorProvider,
    required this.onCalibrationComplete,
    super.key,
  });

  final SensorProvider sensorProvider;
  final void Function(double stepLengthFactor) onCalibrationComplete;

  @override
  State<CalibrationScreen> createState() => _CalibrationScreenState();
}

class _CalibrationScreenState extends State<CalibrationScreen>
    with SingleTickerProviderStateMixin {
  late final CalibrationService _calibration;
  StreamSubscription<SensorReading>? _accelSub;
  late AnimationController _pulseController;

  double _progress = 0;
  int _stepsDetected = 0;
  CalibrationState _state = CalibrationState.idle;

  @override
  void initState() {
    super.initState();
    _calibration = CalibrationService();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _accelSub?.cancel();
    _calibration.cancel();
    _pulseController.dispose();
    super.dispose();
  }

  void _startCalibration() {
    _calibration.start(10.0); // 10 meter target
    widget.sensorProvider.start();

    _accelSub = widget.sensorProvider.userAcceleration.listen((reading) {
      _calibration.feedAcceleration(reading);
      if (mounted) {
        setState(() {
          _progress = _calibration.progress;
          _stepsDetected = _calibration.stepsDetected;
          _state = _calibration.state;
        });
      }
    });

    setState(() {
      _state = CalibrationState.walking;
    });
  }

  void _completeCalibration() {
    _accelSub?.cancel();
    widget.sensorProvider.stop();

    // Use 10m as the actual distance (user walked the target)
    final result = _calibration.complete(10.0);

    setState(() {
      _state = CalibrationState.complete;
      _progress = 1.0;
    });

    // Delay to show result, then return
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) {
        widget.onCalibrationComplete(result.stepLengthFactor);
        Navigator.of(context).pop(result.stepLengthFactor);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Calibrate Step Length'),
        actions: [
          if (_state == CalibrationState.walking)
            TextButton(
              onPressed: _completeCalibration,
              child: const Text('Done'),
            ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Instructions
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('How to Calibrate', style: textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Text(
                      '1. Find a straight hallway (10+ meters)\n'
                      '2. Stand at one end\n'
                      '3. Tap "Start Walking"\n'
                      '4. Walk at your normal pace to the other end\n'
                      '5. Tap "Done" when you reach the end',
                      style: textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 24),

            // Progress indicator
            if (_state == CalibrationState.walking) ...[
              AnimatedBuilder(
                animation: _pulseController,
                builder: (context, child) {
                  return LinearProgressIndicator(
                    value: _progress,
                    minHeight: 12,
                    backgroundColor: colorScheme.surfaceContainerHighest,
                    color: Color.lerp(
                      colorScheme.primary,
                      colorScheme.tertiary,
                      _pulseController.value,
                    ),
                  );
                },
              ),
              const SizedBox(height: 16),
              Text(
                'Steps: $_stepsDetected / ~14',
                style: textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                '${(_progress * 100).toStringAsFixed(0)}% complete',
                style: textTheme.bodyLarge,
                textAlign: TextAlign.center,
              ),
            ],

            if (_state == CalibrationState.complete) ...[
              const Icon(
                Icons.check_circle,
                size: 64,
                color: Colors.green,
              ),
              const SizedBox(height: 16),
              Text(
                'Calibration Complete!',
                style: textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                'Step length factor: '
                '${_calibration.result?.stepLengthFactor.toStringAsFixed(3) ?? "?"}',
                style: textTheme.bodyLarge,
                textAlign: TextAlign.center,
              ),
            ],

            const Spacer(),

            // Action button
            if (_state == CalibrationState.idle)
              FilledButton.icon(
                onPressed: _startCalibration,
                icon: const Icon(Icons.directions_walk),
                label: const Text('Start Walking'),
              ),

            if (_state == CalibrationState.walking)
              OutlinedButton.icon(
                onPressed: _completeCalibration,
                icon: const Icon(Icons.stop),
                label: const Text('Done Walking'),
              ),

            const SizedBox(height: 16),

            // Skip option
            TextButton(
              onPressed: () {
                widget.onCalibrationComplete(0.55); // default factor
                Navigator.of(context).pop(0.55);
              },
              child: const Text('Skip (use default)'),
            ),
          ],
        ),
      ),
    );
  }
}
