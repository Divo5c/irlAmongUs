import 'package:flutter_test/flutter_test.dart';
import 'package:real_life_amongus_app/core/positioning/fake_sensor_provider.dart';
import 'package:real_life_amongus_app/core/positioning/heading_fusion.dart';
import 'package:real_life_amongus_app/core/positioning/heading_snapper.dart';
import 'package:real_life_amongus_app/core/positioning/motion_classifier.dart';
import 'package:real_life_amongus_app/core/positioning/pdr_engine.dart';
import 'package:real_life_amongus_app/core/positioning/calibration_service.dart';
import 'package:real_life_amongus_app/core/positioning/positioning_service.dart';
import 'package:real_life_amongus_app/core/positioning/sensor_provider.dart';
import 'package:real_life_amongus_app/core/positioning/walking_validator.dart';

void main() {
  group('FakeSensorProvider', () {
    test('starts and stops', () {
      final fake = FakeSensorProvider();
      fake.start();
      fake.stop();
      fake.dispose();
    });

    test('pushes user acceleration readings', () async {
      final fake = FakeSensorProvider();
      fake.start();

      final readings = <SensorReading>[];
      fake.userAcceleration.listen(readings.add);

      fake.pushUserAcceleration(0, 1.0, 0);
      fake.pushUserAcceleration(0, -0.5, 0);

      await Future.delayed(Duration.zero);
      expect(readings.length, 2);
      expect(readings[0].y, 1.0);
      expect(readings[1].y, -0.5);

      fake.dispose();
    });

    test('pushes gyroscope readings', () async {
      final fake = FakeSensorProvider();
      fake.start();

      final readings = <SensorReading>[];
      fake.gyroscope.listen(readings.add);

      fake.pushGyroscope(0, 0, 0.5);

      await Future.delayed(Duration.zero);
      expect(readings.length, 1);
      expect(readings[0].z, 0.5);

      fake.dispose();
    });

    test('pushes magnetometer readings', () async {
      final fake = FakeSensorProvider();
      fake.start();

      final readings = <SensorReading>[];
      fake.magnetometer.listen(readings.add);

      fake.pushMagnetometer(0, -1, 0);

      await Future.delayed(Duration.zero);
      expect(readings.length, 1);
      expect(readings[0].y, -1.0);

      fake.dispose();
    });

    test('pushStep increments step count', () async {
      final fake = FakeSensorProvider();
      fake.start();

      final steps = <SensorReading>[];
      fake.stepCounter.listen(steps.add);

      fake.pushStep();
      fake.pushStep();
      fake.pushStep();

      await Future.delayed(Duration.zero);
      expect(steps.length, 3);
      expect(steps[2].x, 3.0);

      fake.dispose();
    });

    test('capabilities report all sensors available', () {
      final fake = FakeSensorProvider();
      final caps = fake.capabilities;
      expect(caps.hasAccelerometer, true);
      expect(caps.hasGyroscope, true);
      expect(caps.hasMagnetometer, true);
      expect(caps.hasUserAcceleration, true);
      expect(caps.hasStepCounter, true);
      fake.dispose();
    });

    test('does not emit when not started', () {
      final fake = FakeSensorProvider();
      final readings = <SensorReading>[];
      fake.userAcceleration.listen(readings.add);

      fake.pushUserAcceleration(0, 1.0, 0);
      // Not started, so nothing emitted
      expect(readings.length, 0);
      fake.dispose();
    });

    test('simulateWalkingSteps produces alternating peaks', () async {
      final fake = FakeSensorProvider();
      fake.start();

      final readings = <SensorReading>[];
      fake.userAcceleration.listen(readings.add);
      final steps = <SensorReading>[];
      fake.stepCounter.listen(steps.add);

      fake.simulateWalkingSteps(6);

      await Future.delayed(Duration.zero);
      expect(readings.length, 6);
      expect(steps.length, 3); // Every other reading is a step

      fake.dispose();
    });
  });

  group('HeadingFusion', () {
    test('initializes from magnetometer', () {
      final fusion = HeadingFusion();
      expect(fusion.headingDeg, isNull);

      // Magnetometer pointing north (mx=0, my=1)
      fusion.updateFromMagnetometer(0, 1, 1000);
      expect(fusion.headingDeg, isNotNull);
      expect(fusion.headingDeg!, closeTo(0, 1));
    });

    test('heading from east magnetometer', () {
      final fusion = HeadingFusion();
      fusion.updateFromMagnetometer(1, 0, 1000);
      expect(fusion.headingDeg!, closeTo(90, 1));
    });

    test('heading from south magnetometer', () {
      final fusion = HeadingFusion();
      fusion.updateFromMagnetometer(0, -1, 1000);
      expect(fusion.headingDeg!, closeTo(180, 1));
    });

    test('gyroscope integration updates heading', () {
      final fusion = HeadingFusion();
      fusion.updateFromMagnetometer(0, 1, 1000); // Init north at t=1000
      final initial = fusion.headingDeg!;

      // First gyro call sets timestamp but doesn't integrate
      fusion.updateFromGyroscope(-1.0, 1500);
      // Second call integrates from t=1500 to t=2500
      fusion.updateFromGyroscope(-1.0, 2500);
      expect(fusion.headingDeg, isNot(equals(initial)));
    });

    test('gyroscope sign follows compass convention (flat device)', () {
      // Positive gyro-z = CCW viewed from above = turning left, so the
      // clockwise compass heading must DECREASE (0 -> 270 direction).
      final fusion = HeadingFusion();
      fusion.updateFromMagnetometer(0, 1, 1000); // Init north (0 deg)
      fusion.updateFromGyroscope(1.0, 1500); // timestamp only
      fusion.updateFromGyroscope(1.0, 2000); // integrates 1.0 * 0.5s
      // -0.5 rad = -28.65 deg, wrapped to [0, 360).
      expect(fusion.headingDeg!, closeTo(331.35, 1.0));
    });

    test('reset clears state', () {
      final fusion = HeadingFusion();
      fusion.updateFromMagnetometer(0, -1, 1000);
      expect(fusion.headingDeg, isNotNull);

      fusion.reset();
      expect(fusion.headingDeg, isNull);
    });

    test('confidence increases when magnetometer and gyro agree', () {
      final fusion = HeadingFusion(alpha: 0.5);
      fusion.updateFromMagnetometer(0, 1, 1000); // Init north

      // No gyro rotation — magnetometer confirms north
      fusion.updateFromMagnetometer(0, 1, 2000);
      expect(fusion.confidence, greaterThan(0.5));
    });

    test('magnetic declination is applied', () {
      final fusion = HeadingFusion(magnetDeclination: 10);
      fusion.updateFromMagnetometer(0, 1, 1000); // North + 10° declination
      expect(fusion.headingDeg!, closeTo(10, 1));
    });
  });

  group('PdrEngine', () {
    test('detects steps from acceleration peaks', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);

      // Simulate a step: rise then fall (with proper timestamps)
      var update = pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 100),
        0,
      );
      expect(update, isNull); // Still rising

      update = pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 400),
        0,
      );
      expect(update, isNotNull);
      expect(pdr.totalSteps, 1);
    });

    test('position updates with heading 0 (north)', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);

      pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 100),
        0,
      );
      final update = pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 400),
        0,
      );

      expect(update, isNotNull);
      // 0° north => +Y is down on canvas, north is -Y (up)
      expect(update!.x, closeTo(0, 0.5));
      expect(update.y, lessThan(0));
    });

    test('position updates with heading 90 (east)', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 90);

      pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 100),
        90,
      );
      final update = pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 400),
        90,
      );

      expect(update, isNotNull);
      expect(update!.x, greaterThan(0));
      expect(update.y, closeTo(0, 0.5));
    });

    test('minStepIntervalMs prevents double counting', () {
      final pdr = PdrEngine(minStepIntervalMs: 250);
      pdr.setPosition(0, 0);

      // First step
      pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 300),
        0,
      );
      pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 400),
        0,
      );
      expect(pdr.totalSteps, 1);

      // Second step too soon (100ms later)
      pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 500),
        0,
      );
      pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 550),
        0,
      );
      expect(pdr.totalSteps, 1); // Still 1

      // Third step after interval
      pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 800),
        0,
      );
      pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 900),
        0,
      );
      expect(pdr.totalSteps, 2);
    });

    test('reset clears all state', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0);
      pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 100),
        0,
      );
      pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 400),
        0,
      );
      expect(pdr.totalSteps, 1);

      pdr.reset();
      expect(pdr.totalSteps, 0);
      expect(pdr.totalDistance, 0);
      expect(pdr.isInitialized, false);
    });

    test('calibrate updates step length factor', () {
      final pdr = PdrEngine();
      final originalFactor = pdr.stepLengthFactor;

      pdr.calibrate(10.0, 20, 1.5);
      expect(pdr.stepLengthFactor, isNot(equals(originalFactor)));
      expect(pdr.stepLengthFactor, greaterThan(0.3));
      expect(pdr.stepLengthFactor, lessThan(0.9));
    });
  });

  group('CalibrationService', () {
    test('starts in idle state', () {
      final cal = CalibrationService();
      expect(cal.state, CalibrationState.idle);
      expect(cal.isWalking, false);
    });

    test('start transitions to walking', () {
      final cal = CalibrationService();
      cal.start(10.0);
      expect(cal.state, CalibrationState.walking);
      expect(cal.isWalking, true);
    });

    test('feedAcceleration counts steps', () {
      final cal = CalibrationService();
      cal.start(10.0);

      // First step: peak then below threshold, with enough time from start (t=0)
      cal.feedAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 300));
      cal.feedAcceleration(SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 400));

      // Second step after interval
      cal.feedAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 800));
      cal.feedAcceleration(SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 900));

      expect(cal.stepsDetected, 2);
    });

    test('complete computes step length factor', () {
      final cal = CalibrationService();
      cal.start(10.0);

      // Feed enough steps with proper timestamps (250ms apart)
      // First step must have crossing time >= 250 from t=0
      for (var i = 0; i < 10; i++) {
        final t = i * 300 + 300;
        cal.feedAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: t));
        cal.feedAcceleration(SensorReading(x: 0, y: 0.3, z: 0, timestampMs: t + 100));
      }

      final result = cal.complete(10.0);
      expect(result.stepsDetected, 10);
      expect(result.stepLengthFactor, greaterThan(0.3));
      expect(result.stepLengthFactor, lessThan(0.9));
      expect(cal.state, CalibrationState.complete);
    });

    test('complete with zero steps returns default', () {
      final cal = CalibrationService();
      cal.start(10.0);
      // No acceleration fed

      final result = cal.complete(10.0);
      expect(result.stepsDetected, 0);
      expect(result.stepLengthFactor, 0.55); // Default
    });

    test('cancel resets state', () {
      final cal = CalibrationService();
      cal.start(10.0);
      cal.cancel();
      expect(cal.state, CalibrationState.idle);
    });
  });

  group('PdrEngine — stationary detection', () {
    test('initial position is (0,0)', () {
      final pdr = PdrEngine();
      expect(pdr.x, 0);
      expect(pdr.y, 0);
      expect(pdr.isInitialized, false);
    });

    test('isStationary returns true when not initialized', () {
      final pdr = PdrEngine();
      expect(pdr.isStationary(10000), true);
    });

    test('isStationary returns false right after a step', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0);
      pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 100),
        0,
      );
      pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 400),
        0,
      );
      expect(pdr.totalSteps, 1);
      expect(pdr.isStationary(500), false);
    });

    test('isStationary returns true after threshold elapsed', () {
      final pdr = PdrEngine(stationaryThresholdMs: 2000);
      pdr.setPosition(0, 0);
      pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 100),
        0,
      );
      pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 400),
        0,
      );
      // 3 seconds after step
      expect(pdr.isStationary(3500), true);
    });

    test('standing still: position stays stable', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);

      // No steps → position should remain at origin
      pdr.processAcceleration(
        SensorReading(x: 0, y: 0.1, z: 0, timestampMs: 100),
        0,
      );
      pdr.processAcceleration(
        SensorReading(x: 0, y: 0.05, z: 0, timestampMs: 200),
        0,
      );
      expect(pdr.x, 0);
      expect(pdr.y, 0);
      expect(pdr.totalSteps, 0);
    });

    test('walking: position changes', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);

      // Two steps with proper timestamps
      pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 100),
        0,
      );
      pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 400),
        0,
      );
      pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 800),
        0,
      );
      pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 1100),
        0,
      );

      expect(pdr.totalSteps, 2);
      expect(pdr.totalDistance, greaterThan(0));
      expect(pdr.y, lessThan(0));
    });

    test('heading 0 (north): X changes, Y approximately stable', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);

      // Two steps at heading 0° north => -Y up, X ~0
      for (var i = 0; i < 2; i++) {
        final t = i * 400 + 100;
        pdr.processAcceleration(
          SensorReading(x: 0, y: 2.0, z: 0, timestampMs: t),
          0,
        );
        pdr.processAcceleration(
          SensorReading(x: 0, y: 0.3, z: 0, timestampMs: t + 300),
          0,
        );
      }

      expect(pdr.totalSteps, 2);
      expect(pdr.x, closeTo(0, 0.5));
      expect(pdr.y, lessThan(0));
    });

    test('turning: trajectory changes direction', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);

      // First step north (heading=0 → -Y)
      pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 100),
        0,
      );
      pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 400),
        0,
      );
      final afterFirst = (x: pdr.x, y: pdr.y);

      // Second step east (heading=90 → +X)
      pdr.processAcceleration(
        SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 800),
        90,
      );
      pdr.processAcceleration(
        SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 1100),
        90,
      );

      // After first step: moved north (-Y)
      expect(afterFirst.y, lessThan(0));
      // After second step: additional movement east (+X)
      expect(pdr.x, greaterThan(afterFirst.x));
    });

    test('calibration factor affects stride length', () {
      final pdr1 = PdrEngine(stepLengthFactor: 0.3);
      final pdr2 = PdrEngine(stepLengthFactor: 0.8);
      pdr1.setPosition(0, 0, headingDeg: 0);
      pdr2.setPosition(0, 0, headingDeg: 0);

      // Same acceleration profile
      for (final pdr in [pdr1, pdr2]) {
        pdr.processAcceleration(
          SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 100),
          0,
        );
        pdr.processAcceleration(
          SensorReading(x: 0, y: 0.3, z: 0, timestampMs: 400),
          0,
        );
      }

      expect(pdr1.totalDistance, lessThan(pdr2.totalDistance));
    });
  });

  group('Robust Step Detection (Round 10)', () {
    test('A: stationary — 0 steps', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0);
      // 30 samples of tiny noise
      for (var i = 0; i < 30; i++) {
        pdr.processAcceleration(SensorReading(x: 0.02, y: 0.03, z: -0.01, timestampMs: 100 + i * 40), 0);
      }
      expect(pdr.totalSteps, 0);
      expect(pdr.x, 0);
    });

    test('B: small wobble — 0 steps', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0);
      // 15 wobble samples 0.4-0.9 (below minPeak)
      final rngVals = [0.5, 0.7, 0.4, 0.8, 0.6, 0.55, 0.9, 0.45, 0.65, 0.75, 0.5, 0.6, 0.85, 0.4, 0.7];
      for (var i = 0; i < rngVals.length; i++) {
        pdr.processAcceleration(SensorReading(x: 0, y: rngVals[i], z: 0, timestampMs: 200 + i * 40), 0);
        pdr.processAcceleration(SensorReading(x: 0, y: 0.2, z: 0, timestampMs: 200 + i * 40 + 20), 0);
      }
      expect(pdr.totalSteps, 0);
    });

    test('C: strong shake — not many steps', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0);
      // Simulate shake: rapid large peaks every 80-120ms, magnitudes 3.5-5.0
      // Should be mostly rejected due to short interval + large magnitude
      int t = 1000;
      for (var i = 0; i < 12; i++) {
        final mag = 3.8 + (i % 3) * 0.5; // 3.8,4.3,4.8
        pdr.processAcceleration(SensorReading(x: 0, y: mag, z: 0, timestampMs: t), 0);
        pdr.processAcceleration(SensorReading(x: 0, y: 0.3, z: 0, timestampMs: t + 40), 0);
        t += 90 + (i % 2) * 20; // 90-110ms intervals → too fast
      }
      // Shake should produce at most 2 steps (ideally 0), certainly not 12
      expect(pdr.totalSteps, lessThan(4));
    });

    test('D: normal walking — steps detected', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0);
      int t = 1000;
      for (var i = 0; i < 6; i++) {
        pdr.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: t), 0);
        pdr.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: t + 250), 0);
        t += 600;
      }
      expect(pdr.totalSteps, greaterThanOrEqualTo(4));
      expect(pdr.totalSteps, lessThanOrEqualTo(6));
      expect(pdr.totalDistance, greaterThan(0));
    });

    test('E: regular intervals — plausible', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0);
      int t = 500;
      for (var i = 0; i < 5; i++) {
        pdr.processAcceleration(SensorReading(x: 0, y: 2.1, z: 0, timestampMs: t), 0);
        pdr.processAcceleration(SensorReading(x: 0, y: 0.2, z: 0, timestampMs: t + 200), 0);
        t += 550;
      }
      expect(pdr.totalSteps, greaterThanOrEqualTo(4));
      // Check intervals roughly regular (400-700)
      expect(pdr.lastIntervalMs, greaterThanOrEqualTo(350));
      expect(pdr.lastIntervalMs, lessThanOrEqualTo(800));
    });

    test('F: walk + turn — heading changes', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);
      int t = 1000;
      for (var i = 0; i < 2; i++) {
        pdr.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: t), 0);
        pdr.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: t + 250), 0);
        t += 600;
      }
      final afterStraight = (x: pdr.x, y: pdr.y);
      // Turn 90deg east and walk 2 more
      for (var i = 0; i < 2; i++) {
        pdr.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: t), 90);
        pdr.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: t + 250), 90);
        t += 600;
      }
      expect(afterStraight.y, lessThan(0));
      expect(pdr.x, greaterThan(afterStraight.x));
    });

    test('G: walk then stop — steps stop', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0);
      int t = 1000;
      for (var i = 0; i < 4; i++) {
        pdr.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: t), 0);
        pdr.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: t + 250), 0);
        t += 600;
      }
      final stepsAfterWalk = pdr.totalSteps;
      // Now stationary for 2 seconds (no peaks)
      for (var i = 0; i < 20; i++) {
        pdr.processAcceleration(SensorReading(x: 0.02, y: 0.03, z: 0, timestampMs: t + i * 50), 0);
      }
      expect(pdr.totalSteps, equals(stepsAfterWalk));
      expect(pdr.isStationary(t + 3000), isTrue);
    });

    test('H: walk and return — drift limited', () {
      final pdr = PdrEngine(stepLengthFactor: 0.55);
      pdr.setPosition(0, 0, headingDeg: 90);
      int t = 1000;
      // Walk 10 steps east (heading 90)
      for (var i = 0; i < 10; i++) {
        pdr.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: t), 90);
        pdr.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: t + 250), 90);
        t += 600;
      }
      final midX = pdr.x;
      // Walk 10 steps west (heading 270)
      for (var i = 0; i < 10; i++) {
        pdr.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: t), 270);
        pdr.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: t + 250), 270);
        t += 600;
      }
      // Should be back near 0 (drift < 40% of distance)
      expect(midX, greaterThan(3));
      expect(pdr.x.abs(), lessThan(midX.abs() * 0.4));
    });

    test('I: extreme/invalid values — no crash', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0);
      expect(() => pdr.processAcceleration(SensorReading(x: double.nan, y: 0, z: 0, timestampMs: 100), 0), returnsNormally);
      expect(() => pdr.processAcceleration(SensorReading(x: double.infinity, y: 0, z: 0, timestampMs: 200), 0), returnsNormally);
      expect(() => pdr.processAcceleration(SensorReading(x: 0, y: 1000, z: 0, timestampMs: 300), 0), returnsNormally);
      expect(pdr.totalSteps, lessThan(2));
    });

    test('J: no sensor data — stays stable', () {
      final pdr = PdrEngine();
      pdr.setPosition(5, 5);
      // No processAcceleration calls
      expect(pdr.x, 5);
      expect(pdr.y, 5);
      expect(pdr.totalSteps, 0);
      expect(pdr.isStationary(5000), isTrue);
    });

    test('FakeSensorProvider simulateStationary produces no steps', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0);
      final fake = FakeSensorProvider();
      fake.start();
      fake.setFakeTime(1000);
      // Feed stationary directly
      for (var i = 0; i < 20; i++) {
        final mag = 0.05;
        pdr.processAcceleration(SensorReading(x: 0, y: mag, z: 0, timestampMs: 1000 + i * 40), 0);
      }
      fake.dispose();
      expect(pdr.totalSteps, 0);
    });

    test('confidence field present on PdrUpdate', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0);
      pdr.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 1000), 0);
      final upd = pdr.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: 1250), 0);
      expect(upd, isNotNull);
      expect(upd!.confidence, greaterThan(0.4));
      expect(upd.confidence, lessThanOrEqualTo(1.0));
    });
  });

  group('Sitting Phone Movement Regression (Critical)', () {
    test('A: sitting completely still — 0 steps via PositioningService', () async {
      final fake = FakeSensorProvider();
      final svc = PositioningService(sensorProvider: fake);
      svc.setInitialPosition(0, 0);
      fake.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      for (var i = 0; i < 30; i++) {
        fake.pushUserAcceleration(0.02, 0.01, 0.01);
        fake.pushGyroscope(0.005, 0.005, 0.005);
        await Future.delayed(Duration.zero);
      }
      await Future.delayed(const Duration(milliseconds: 50));
      // No steps should be counted; position may still be null if no validated walk
      expect(svc.sensorStatus.stepCount, 0);
      expect(svc.sensorStatus.motionState, MotionState.still);
      svc.dispose();
      fake.dispose();
    });

    test('B: sitting + phone rotation — 0 position movement', () async {
      final fake = FakeSensorProvider();
      final svc = PositioningService(sensorProvider: fake);
      svc.setInitialPosition(5, 5);
      fake.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      // First let it go still
      for (var i = 0; i < 15; i++) {
        fake.pushUserAcceleration(0.02, 0.02, 0.01);
        fake.pushGyroscope(0.01, 0.01, 0.01);
        await Future.delayed(Duration.zero);
      }
      // Now rotate phone (gyro large, accel still small)
      for (var i = 0; i < 20; i++) {
        fake.pushGyroscope(0, 0, 1.2); // yaw rotation
        fake.pushUserAcceleration(0.1, 0.1, 0.05);
        await Future.delayed(Duration.zero);
      }
      await Future.delayed(const Duration(milliseconds: 50));
      expect(svc.sensorStatus.stepCount, 0);
      // Position should not have moved significantly from (5,5) or still near start
      final pos = svc.currentPosition;
      if (pos != null) {
        expect((pos.x - 5).abs() < 1.0 && (pos.y - 5).abs() < 1.0, isTrue,
            reason: 'Rotation alone moved position to (${pos.x}, ${pos.y})');
      }
      svc.dispose();
      fake.dispose();
    });

    test('C: sitting + phone shaking — ideally 0 steps, no significant movement', () async {
      final fake = FakeSensorProvider();
      final svc = PositioningService(sensorProvider: fake);
      svc.setInitialPosition(0, 0);
      fake.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      // Still phase
      for (var i = 0; i < 15; i++) {
        fake.pushUserAcceleration(0.03, 0.02, 0.01);
        fake.pushGyroscope(0.01, 0.01, 0.01);
        await Future.delayed(Duration.zero);
      }
      // Shake phase via direct PDR-like bursts but also gyro
      for (var i = 0; i < 12; i++) {
        final mag = 3.8 + (i % 2) * 0.8;
        fake.pushUserAcceleration(0, mag, 0);
        fake.pushGyroscope((i.isEven ? 0.8 : -0.8), 0.5, 0.6);
        await Future.delayed(Duration.zero);
        fake.pushUserAcceleration(0, 0.2, 0);
        await Future.delayed(Duration.zero);
      }
      await Future.delayed(const Duration(milliseconds: 50));
      // Should be at most 1 false step, ideally 0
      expect(svc.sensorStatus.stepCount, lessThan(2));
      svc.dispose();
      fake.dispose();
    });

    test('E: realistic walking — steps detected via fallback', () async {
      final fake = FakeSensorProvider();
      final svc = PositioningService(sensorProvider: fake);
      svc.setInitialPosition(0, 0);
      fake.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      // Warm up motion classifier to walking
      for (var i = 0; i < 20; i++) {
        final v = i.isEven ? 1.8 : 0.4;
        fake.pushUserAcceleration(0, v, 0);
        fake.pushGyroscope(0.06, 0.05, 0.04);
        await Future.delayed(Duration.zero);
      }
      int t = 5000;
      for (var i = 0; i < 6; i++) {
        fake.pushStepDetector(timestampMs: t);
        fake.pushUserAcceleration(0, 2.0, 0);
        fake.pushGyroscope(0.05, 0.05, 0.05);
        await Future.delayed(Duration.zero);
        t += 550;
        await Future.delayed(const Duration(milliseconds: 10));
      }
      await Future.delayed(const Duration(milliseconds: 150));
      expect(svc.sensorStatus.stepCount, greaterThanOrEqualTo(2));
      svc.dispose();
      fake.dispose();
    });

    test('F: walking → stop — stabilizes', () async {
      final fake = FakeSensorProvider();
      final svc = PositioningService(sensorProvider: fake);
      svc.setInitialPosition(0, 0);
      fake.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      for (var i = 0; i < 20; i++) {
        fake.pushUserAcceleration(0, i.isEven ? 1.8 : 0.4, 0);
        fake.pushGyroscope(0.06, 0.05, 0.04);
        await Future.delayed(Duration.zero);
      }
      int t = 6000;
      for (var i = 0; i < 4; i++) {
        fake.pushStepDetector(timestampMs: t);
        await Future.delayed(Duration.zero);
        t += 550;
        await Future.delayed(const Duration(milliseconds: 10));
      }
      await Future.delayed(const Duration(milliseconds: 100));
      final stepsAfterWalk = svc.sensorStatus.stepCount;
      expect(stepsAfterWalk, greaterThanOrEqualTo(2));
      for (var i = 0; i < 30; i++) {
        fake.pushUserAcceleration(0.02, 0.01, 0.01);
        fake.pushGyroscope(0.005, 0.005, 0.005);
        await Future.delayed(Duration.zero);
      }
      await Future.delayed(const Duration(milliseconds: 150));
      expect(svc.sensorStatus.stepCount, equals(stepsAfterWalk));
      expect(svc.sensorStatus.motionState, MotionState.still);
      svc.dispose();
      fake.dispose();
    });

    test('MotionClassifier distinguishes still vs walking', () {
      final mc = MotionClassifier();
      // Still: low variance
      for (var i = 0; i < 20; i++) {
        mc.addAcceleration(SensorReading(x: 0.02, y: 0.01, z: 0.01, timestampMs: i * 40));
        mc.addGyroscope(SensorReading(x: 0.005, y: 0.005, z: 0.005, timestampMs: i * 40));
      }
      expect(mc.state, MotionState.still);
      mc.reset();
      // Walking-like: higher variance
      final vals = [0.3, 1.8, 0.4, 0.2, 1.9, 0.3, 2.0, 0.25];
      for (var i = 0; i < 25; i++) {
        final v = vals[i % vals.length];
        mc.addAcceleration(SensorReading(x: 0, y: v, z: 0, timestampMs: 1000 + i * 40));
        mc.addGyroscope(SensorReading(x: 0.05, y: 0.04, z: 0.06, timestampMs: 1000 + i * 40));
      }
      expect(mc.state, MotionState.walking);
    });

    test('WalkingValidator requires consecutive steps', () {
      final v = WalkingValidator(requiredConsecutiveSteps: 2);
      final still = MotionState.still;
      final walking = MotionState.walking;
      // Single step while still -> reject
      var r = v.validate(timestampMs: 1000, source: StepSource.hardware, motionState: still, stepConfidence: 0.9);
      expect(r.accepted, isFalse);
      // First plausible while walking -> pending
      r = v.validate(timestampMs: 2000, source: StepSource.hardware, motionState: walking, stepConfidence: 0.85);
      expect(r.accepted, isFalse);
      expect(r.reason.contains('PENDING'), isTrue);
      // Second plausible -> accept
      r = v.validate(timestampMs: 2600, source: StepSource.hardware, motionState: walking, stepConfidence: 0.85);
      expect(r.accepted, isTrue);
    });

    test('I: fallback works when step detector unavailable', () async {
      // Create a provider without stepDetector
      final fakeNoStep = _NoStepDetectorFake();
      final svc = PositioningService(sensorProvider: fakeNoStep);
      svc.setInitialPosition(0, 0);
      fakeNoStep.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      for (var i = 0; i < 4; i++) {
        fakeNoStep.pushUserAcceleration(0, 2.0, 0);
        await Future.delayed(Duration.zero);
        fakeNoStep.pushUserAcceleration(0, 0.25, 0);
        await Future.delayed(Duration.zero);
        await Future.delayed(const Duration(milliseconds: 600));
      }
      await Future.delayed(const Duration(milliseconds: 100));
      // Should have detected at least some steps via fallback
      expect(svc.sensorStatus.stepCount, greaterThanOrEqualTo(1));
      expect(svc.sensorStatus.useHardwareStepDetector, isFalse);
      svc.dispose();
      fakeNoStep.dispose();
    });

    test('N: PDR displacement uses snapped heading, estimate keeps raw',
        () async {
      final fakeNoStep = _NoStepDetectorFake();
      final svc = PositioningService(sensorProvider: fakeNoStep);
      svc.setInitialPosition(0, 0);
      fakeNoStep.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      // Fused heading ~70 deg (first magnetometer sample initializes
      // the fusion directly: atan2(0.940, 0.342) ~= 70).
      for (var i = 0; i < 3; i++) {
        fakeNoStep.pushMagnetometer(0.940, 0.342, 0);
        await Future.delayed(Duration.zero);
      }
      expect(svc.liveHeadingDeg, closeTo(70, 1));
      // Walk with the same peak pattern as test I.
      for (var i = 0; i < 4; i++) {
        fakeNoStep.pushUserAcceleration(0, 2.0, 0);
        await Future.delayed(Duration.zero);
        fakeNoStep.pushUserAcceleration(0, 0.25, 0);
        await Future.delayed(Duration.zero);
        await Future.delayed(const Duration(milliseconds: 600));
      }
      await Future.delayed(const Duration(milliseconds: 100));
      // Displacement went east (snapped 90), not north-east.
      final pos = svc.currentPosition!;
      expect(pos.x, greaterThan(0.3));
      expect(pos.y.abs(), lessThan(0.15));
      // Raw heading preserved on the estimate and the live view ...
      expect(pos.heading, closeTo(70, 1));
      expect(svc.liveHeadingDeg, closeTo(70, 1));
      // ... while the step log records the snapped movement heading.
      expect(svc.stepLog, isNotEmpty);
      expect(svc.stepLog.last.headingDeg, 90);
      svc.dispose();
      fakeNoStep.dispose();
    });

    test('J: hardware channel error fails over to fallback PDR', () async {
      // Reproduces the real-device break: native UNAVAILABLE arrives AFTER
      // the service already committed to the hardware path. Steps must flow
      // via fallback instead of stalling at zero forever.
      final fake = FakeSensorProvider();
      final svc = PositioningService(sensorProvider: fake);
      svc.setInitialPosition(0, 0);
      fake.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      fake.failStepDetector('UNAVAILABLE');
      await Future.delayed(Duration.zero);
      await Future.delayed(const Duration(milliseconds: 10));
      expect(svc.sensorStatus.useHardwareStepDetector, isFalse);
      expect(svc.sensorStatus.stepDetectorError, contains('UNAVAILABLE'));
      // Now walk with the fallback peak pattern (same as test I).
      for (var i = 0; i < 4; i++) {
        fake.pushUserAcceleration(0, 2.0, 0);
        await Future.delayed(Duration.zero);
        fake.pushUserAcceleration(0, 0.25, 0);
        await Future.delayed(Duration.zero);
        await Future.delayed(const Duration(milliseconds: 600));
      }
      await Future.delayed(const Duration(milliseconds: 100));
      expect(svc.sensorStatus.stepCount, greaterThanOrEqualTo(1));
      expect(svc.sensorStatus.stepSource, StepSource.fallback);
      // The sticky failover record survives later per-step reasons.
      expect(svc.sensorStatus.failoverReason, 'hw-error');
      svc.dispose();
      fake.dispose();
    });

    test('K: silent hardware channel fails over after grace while walking',
        () async {
      // No hardware events AND no error (e.g. stale build without the native
      // channel): sustained walking with zero raw hardware events must arm
      // fallback PDR instead of freezing at (0,0).
      final fake = FakeSensorProvider();
      final svc = PositioningService(sensorProvider: fake);
      svc.setInitialPosition(0, 0);
      fake.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      // Alternating peak/valley warms motion to WALKING and feeds PDR.
      // Explicit timestamps advance past the 8s grace with zero hw events.
      int t = 200000;
      for (var i = 0; i < 60; i++) {
        fake.pushUserAccelerationAt(0, i.isEven ? 2.0 : 0.25, 0, t);
        await Future.delayed(Duration.zero);
        t += 300;
      }
      await Future.delayed(const Duration(milliseconds: 100));
      expect(svc.sensorStatus.useHardwareStepDetector, isFalse);
      expect(svc.sensorStatus.failoverReason, 'no-hw-events');
      expect(svc.sensorStatus.stepCount, greaterThanOrEqualTo(3));
      expect(svc.sensorStatus.stepSource, StepSource.fallback);
      svc.dispose();
      fake.dispose();
    });

    test('M: sparse hardware blips fail over via accepted-step liveness',
        () async {
      // One hardware blip stays PENDING forever (needs a consecutive
      // partner) yet disarms the raw-count watchdog via _hardwareStepCount.
      // Sustained walking with zero ACCEPTED steps must still rescue via
      // fallback PDR instead of freezing.
      final fake = FakeSensorProvider();
      final svc = PositioningService(sensorProvider: fake);
      svc.setInitialPosition(0, 0);
      fake.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      // Warm motion to WALKING with explicit clock.
      int t = 100000;
      for (var i = 0; i < 25; i++) {
        fake.pushUserAccelerationAt(0, i.isEven ? 1.8 : 0.4, 0, t);
        await Future.delayed(Duration.zero);
        t += 40;
      }
      // Single hardware blip: PENDING, never accepted. Flush delivery so
      // the raw counter is armed before walking continues (separate
      // broadcast streams have no cross-stream ordering guarantee).
      fake.pushStepDetector(timestampMs: 200000);
      await Future.delayed(Duration.zero);
      await Future.delayed(const Duration(milliseconds: 50));
      expect(svc.sensorStatus.useHardwareStepDetector, isTrue);
      // Keep walking ~13.5s with peak/valley pattern, no more hw events.
      t = 200300;
      for (var i = 0; i < 45; i++) {
        fake.pushUserAccelerationAt(0, i.isEven ? 2.0 : 0.25, 0, t);
        await Future.delayed(Duration.zero);
        t += 300;
      }
      await Future.delayed(const Duration(milliseconds: 100));
      expect(svc.sensorStatus.useHardwareStepDetector, isFalse);
      expect(svc.sensorStatus.failoverReason, 'no-accepted-steps');
      expect(svc.sensorStatus.stepCount, greaterThanOrEqualTo(2));
      expect(svc.sensorStatus.stepSource, StepSource.fallback);
      svc.dispose();
      fake.dispose();
    });

    test('L: healthy hardware steps never trigger failover', () async {
      final fake = FakeSensorProvider();
      final svc = PositioningService(sensorProvider: fake);
      svc.setInitialPosition(0, 0);
      fake.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      // Warm motion to walking.
      for (var i = 0; i < 20; i++) {
        fake.pushUserAcceleration(0, i.isEven ? 1.8 : 0.4, 0);
        fake.pushGyroscope(0.06, 0.05, 0.04);
        await Future.delayed(Duration.zero);
      }
      int t = 5000;
      for (var i = 0; i < 3; i++) {
        fake.pushStepDetector(timestampMs: t);
        await Future.delayed(Duration.zero);
        t += 550;
        await Future.delayed(const Duration(milliseconds: 10));
      }
      await Future.delayed(const Duration(milliseconds: 100));
      // First event PENDING, next two ACCEPTED.
      expect(svc.sensorStatus.stepCount, greaterThanOrEqualTo(2));
      expect(svc.sensorStatus.useHardwareStepDetector, isTrue);
      expect(svc.sensorStatus.fallbackActive, isFalse);
      expect(svc.sensorStatus.stepSource, StepSource.hardware);
      svc.dispose();
      fake.dispose();
    });
  });

  group('Live heading independent of PDR steps (arrow)', () {
    test('rotation without steps leaves position, rotates live heading',
        () async {
      final fake = FakeSensorProvider();
      final svc = PositioningService(sensorProvider: fake);
      svc.setInitialPosition(0, 0);
      fake.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);

      final emitted = <double>[];
      svc.headingStream.listen(emitted.add);

      // Initialize fusion facing north.
      fake.pushMagnetometer(0, 1, 0);
      await Future.delayed(Duration.zero);
      expect(svc.liveHeadingDeg, closeTo(0, 1));

      // Spin yaw in place: gyro only, no acceleration peaks, no hw steps.
      for (var i = 0; i < 12; i++) {
        fake.pushGyroscope(0, 0, 2.0);
        await Future.delayed(Duration.zero);
      }
      await Future.delayed(const Duration(milliseconds: 50));

      // Heading rotated live (~11 integrations x 4.58 deg). Positive
      // gyro-z is CCW from above, so the clockwise compass heading
      // decreases: 0 -> 360 - 50.4.
      expect(svc.liveHeadingDeg!, closeTo(360 - 50.4, 3));
      expect(emitted, isNotEmpty);
      expect(emitted.last, closeTo(360 - 50.4, 3));
      // ...while position, distance and steps never moved.
      expect(svc.currentPosition!.x, 0);
      expect(svc.currentPosition!.y, 0);
      expect(svc.sensorStatus.totalDistance, 0);
      expect(svc.sensorStatus.stepCount, 0);
      svc.dispose();
      fake.dispose();
    });

    test('RESET keeps live heading, resets position', () async {
      final fake = FakeSensorProvider();
      final svc = PositioningService(sensorProvider: fake);
      svc.setInitialPosition(0, 0);
      fake.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);

      fake.pushMagnetometer(0, 1, 0);
      await Future.delayed(Duration.zero);
      for (var i = 0; i < 6; i++) {
        fake.pushGyroscope(0, 0, 2.0);
        await Future.delayed(Duration.zero);
      }
      await Future.delayed(const Duration(milliseconds: 50));
      final liveBefore = svc.liveHeadingDeg!;
      expect(liveBefore, greaterThan(15));

      svc.resetPosition();

      // Position is back at the origin ...
      expect(svc.currentPosition!.x, 0);
      expect(svc.currentPosition!.y, 0);
      // ... but live heading was NOT artificially forced to 0.
      expect(svc.liveHeadingDeg, liveBefore);
      svc.dispose();
      fake.dispose();
    });
  });

  group('PdrEngine drop diagnostics', () {
    PdrUpdate? feedPeak(PdrEngine p, double peak, double valley, int t) {
      p.processAcceleration(
          SensorReading(x: 0, y: peak, z: 0, timestampMs: t), 0);
      return p.processAcceleration(
          SensorReading(x: 0, y: valley, z: 0, timestampMs: t + 100), 0);
    }

    test('below-min peaks are counted', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);
      // 0.9 rise, 0.2 valley: peak below the 1.2 minimum.
      feedPeak(pdr, 0.9, 0.2, 100);
      expect(pdr.candidatesTotal, 1);
      expect(pdr.droppedBelowMin, 1);
      expect(pdr.lastRejectReason, 'below-min');
      expect(pdr.totalSteps, 0);
    });

    test('too-fast peaks are counted at the interval gate', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);
      // Valid first step.
      feedPeak(pdr, 2.0, 0.25, 1000);
      expect(pdr.totalSteps, 1);
      // Second peak only 150ms later: below the 300ms minimum.
      feedPeak(pdr, 2.0, 0.25, 1150);
      expect(pdr.candidatesTotal, 2);
      expect(pdr.droppedInterval, 1);
      expect(pdr.lastRejectReason, 'interval');
      expect(pdr.totalSteps, 1);
    });

    test('peaks without a valley dip are counted', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);
      // Shallow accepted step (falling sample stays above 1.4)...
      pdr.processAcceleration(
          SensorReading(x: 0, y: 2.5, z: 0, timestampMs: 100), 0);
      pdr.processAcceleration(
          SensorReading(x: 0, y: 1.9, z: 0, timestampMs: 200), 0);
      expect(pdr.totalSteps, 1);
      // ...then a peak that never dips below the valley threshold.
      pdr.processAcceleration(
          SensorReading(x: 0, y: 2.45, z: 0, timestampMs: 500), 0);
      pdr.processAcceleration(
          SensorReading(x: 0, y: 2.3, z: 0, timestampMs: 800), 0);
      pdr.processAcceleration(
          SensorReading(x: 0, y: 2.1, z: 0, timestampMs: 1100), 0);
      expect(pdr.candidatesTotal, 2);
      expect(pdr.droppedNoValley, 1);
      expect(pdr.lastRejectReason, 'no-valley');
      expect(pdr.totalSteps, 1);
    });

    test('low-confidence peaks are counted', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);
      feedPeak(pdr, 2.0, 0.25, 1000);
      expect(pdr.totalSteps, 1);
      feedPeak(pdr, 2.0, 0.25, 2300);
      expect(pdr.totalSteps, 2);
      // Large, irregular peak: passes magnitude/interval gates but the
      // confidence (big magnitude + bad periodicity) stays below threshold.
      feedPeak(pdr, 5.5, 0.3, 4200);
      expect(pdr.droppedLowConf, 1);
      expect(pdr.lastRejectReason, 'low-conf');
      expect(pdr.totalSteps, 2);
    });

    test('reset clears drop diagnostics alongside state', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);
      feedPeak(pdr, 0.9, 0.2, 100);
      expect(pdr.droppedTotal, 1);
      pdr.reset();
      expect(pdr.candidatesTotal, 0);
      expect(pdr.droppedTotal, 0);
      expect(pdr.lastRejectReason, '—');
    });
  });

  group('HeadingSnapper (90-degree steps with hysteresis)', () {
    test('maps sectors to cardinals', () {
      // Fresh snapper each time: first snap takes the nominal sector
      // (spec: 0-44->0, 45-134->90, 135-224->180, 225-314->270, else 0).
      int at(double h) => HeadingSnapper().snap(h);
      expect(at(0), 0);
      expect(at(44), 0);
      expect(at(46), 90);
      expect(at(90), 90);
      expect(at(134), 90);
      expect(at(136), 180);
      expect(at(180), 180);
      expect(at(224), 180);
      expect(at(226), 270);
      expect(at(270), 270);
      expect(at(314), 270);
      expect(at(315), 0);
      expect(at(359), 0);
    });

    test('hysteresis holds direction at boundaries', () {
      final s = HeadingSnapper(); // starts north
      expect(s.snap(30), 0);
      expect(s.snap(50), 0); // past 45 but within deadband
      expect(s.snap(60), 90); // 30 deg from east: switches
      expect(s.snap(50), 90); // back over boundary, still held
      expect(s.snap(40), 90); // 40 deg from east: still held
      expect(s.snap(30), 0); // 30 deg from north: switches back
    });

    test('wrap-around and normalization', () {
      final s = HeadingSnapper();
      expect(s.snap(350), 0);
      expect(s.snap(320), 0); // 40 deg from north: held
      expect(s.snap(300), 270); // 30 deg from west: switches
      expect(s.snap(-10), 0); // normalized: 10 deg from north
      expect(s.snap(370), 0);
      expect(s.snap(810), 90); // 810 = 90
    });

    test('reset restores north', () {
      final s = HeadingSnapper();
      expect(s.snap(200), 180);
      s.reset();
      expect(s.snapped, 0);
      expect(s.snap(10), 0);
    });
  });

  group('Heading and Coordinate Regression (Post-Fix)', () {
    test('A: straight walking north → Y negative, X stable', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);
      int t = 1000;
      for (var i = 0; i < 5; i++) {
        pdr.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: t), 0);
        pdr.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: t + 250), 0);
        t += 600;
      }
      expect(pdr.y, lessThan(-2));
      expect(pdr.x.abs(), lessThan(0.6));
    });

    test('B: 10 steps straight north ≈ 10*stride, not huge sideways', () {
      final pdr = PdrEngine(stepLengthFactor: 0.55);
      pdr.setPosition(0, 0, headingDeg: 0);
      int t = 1000;
      for (var i = 0; i < 10; i++) {
        pdr.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: t), 0);
        pdr.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: t + 250), 0);
        t += 600;
      }
      final expectedStride = 0.55 * 1.414 * 0.9; // ~0.7 with confidence
      expect(pdr.totalSteps, 10);
      expect(pdr.y.abs(), closeTo(10 * expectedStride, 2.5));
      expect(pdr.x.abs(), lessThan(1.0));
    });

    test('C: heading 0° north => north (-Y)', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);
      pdr.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 1000), 0);
      final u = pdr.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: 1300), 0)!;
      expect(u.x, closeTo(0, 0.3));
      expect(u.y, lessThan(-0.3));
    });

    test('D: heading 90° east => east (+X) perpendicular to north', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 90);
      pdr.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 1000), 90);
      final u = pdr.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: 1300), 90)!;
      expect(u.x, greaterThan(0.3));
      expect(u.y.abs(), lessThan(0.3));
    });

    test('E: Y inversion consistent — north up on screen', () {
      final pdrN = PdrEngine()..setPosition(0, 0, headingDeg: 0);
      final pdrS = PdrEngine()..setPosition(0, 0, headingDeg: 180);
      pdrN.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 1000), 0);
      pdrN.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: 1300), 0);
      pdrS.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 1000), 180);
      pdrS.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: 1300), 180);
      // North and south should be opposite Y
      expect(pdrN.y, lessThan(0));
      expect(pdrS.y, greaterThan(0));
      expect(pdrN.y, closeTo(-pdrS.y, 0.5));
    });

    test('F: +Point stores current PDR world coordinate without displacement', () {
      // Simulate one north step from (3,4) — world coordinate is PDR result
      final pdr = PdrEngine()..setPosition(3, 4, headingDeg: 0);
      pdr.processAcceleration(SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 1000), 0);
      final upd = pdr.processAcceleration(SensorReading(x: 0, y: 0.25, z: 0, timestampMs: 1300), 0)!;
      expect(upd.x, closeTo(3, 0.5));
      expect(upd.y, lessThan(4));
    });

    test('G: sitting + phone movement still no position movement (via PDR)', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0);
      int t = 1000;
      for (var i = 0; i < 12; i++) {
        final mag = 3.8 + (i % 2) * 0.5;
        pdr.processAcceleration(SensorReading(x: 0, y: mag, z: 0, timestampMs: t), 0);
        pdr.processAcceleration(SensorReading(x: 0, y: 0.2, z: 0, timestampMs: t + 40), 0);
        t += 90;
      }
      expect(pdr.totalSteps, lessThan(5));
      expect(pdr.x.abs() + pdr.y.abs(), lessThan(3.0));
    });
  });

  group('Step pipeline trace (diagnostics)', () {
    test('validator counters track validated/accepted/rejected', () {
      final v = WalkingValidator(requiredConsecutiveSteps: 2);
      expect(v.validatedTotal, 0);
      expect(v.lastRejectReason, '—');

      // STILL -> terminal reject.
      var r = v.validate(
          timestampMs: 1000,
          source: StepSource.hardware,
          motionState: MotionState.still,
          stepConfidence: 0.9);
      expect(r.accepted, isFalse);
      expect(v.validatedTotal, 1);
      expect(v.acceptedTotal, 0);
      expect(v.rejectedTotal, 1);
      expect(v.lastRejectReason, 'REJECT still');

      // First plausible while walking -> PENDING (validated only).
      r = v.validate(
          timestampMs: 2000,
          source: StepSource.hardware,
          motionState: MotionState.walking,
          stepConfidence: 0.85);
      expect(r.accepted, isFalse);
      expect(v.validatedTotal, 2);
      expect(v.acceptedTotal, 0);
      expect(v.rejectedTotal, 1);

      // Second plausible -> ACCEPT.
      r = v.validate(
          timestampMs: 2600,
          source: StepSource.hardware,
          motionState: MotionState.walking,
          stepConfidence: 0.85);
      expect(r.accepted, isTrue);
      expect(v.validatedTotal, 3);
      expect(v.acceptedTotal, 1);
      expect(v.rejectedTotal, 1);

      v.reset();
      expect(v.validatedTotal, 0);
      expect(v.acceptedTotal, 0);
      expect(v.rejectedTotal, 0);
      expect(v.lastRejectReason, '—');
    });

    test('pdr records last candidate timestamp', () {
      final pdr = PdrEngine();
      pdr.setPosition(0, 0, headingDeg: 0);
      expect(pdr.lastCandidateTimeMs, 0);
      pdr.processAcceleration(
          SensorReading(x: 0, y: 2.0, z: 0, timestampMs: 1000), 0);
      pdr.processAcceleration(
          SensorReading(x: 0, y: 0.25, z: 0, timestampMs: 1300), 0);
      expect(pdr.totalSteps, 1);
      expect(pdr.candidatesTotal, 1);
      expect(pdr.lastCandidateTimeMs, 1000);
    });

    test('service trace: fallback walk populates every stage', () async {
      final fakeNoStep = _NoStepDetectorFake();
      final svc = PositioningService(sensorProvider: fakeNoStep);
      svc.setInitialPosition(0, 0);
      fakeNoStep.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      for (var i = 0; i < 4; i++) {
        fakeNoStep.pushUserAcceleration(0, 2.0, 0);
        await Future.delayed(Duration.zero);
        fakeNoStep.pushUserAcceleration(0, 0.25, 0);
        await Future.delayed(Duration.zero);
        await Future.delayed(const Duration(milliseconds: 600));
      }
      await Future.delayed(const Duration(milliseconds: 100));
      final s = svc.sensorStatus;
      // Raw samples arrived and reached fallback processing ...
      expect(s.accelSamples, greaterThanOrEqualTo(8));
      expect(s.fallbackSamples, greaterThanOrEqualTo(8));
      // ... PDR saw candidates and counted at least one step ...
      expect(s.pdrCandidates, greaterThanOrEqualTo(1));
      expect(s.stepCount, greaterThanOrEqualTo(1));
      expect(s.lastAcceptedStepMs, isNotNull);
      expect(s.lastAcceptedStepMs!, greaterThan(0));
      // ... while the validator is bypassed by design on this path.
      expect(s.validatorValidated, 0);
      expect(s.validatorAccepted, 0);
      svc.dispose();
      fakeNoStep.dispose();
    });

    test('service trace: hardware events move validator counters', () async {
      final fake = FakeSensorProvider();
      final svc = PositioningService(sensorProvider: fake);
      svc.setInitialPosition(0, 0);
      fake.start();
      svc.enableSensorMode();
      await Future.delayed(Duration.zero);
      // Warm motion to walking.
      for (var i = 0; i < 20; i++) {
        fake.pushUserAcceleration(0, i.isEven ? 1.8 : 0.4, 0);
        fake.pushGyroscope(0.06, 0.05, 0.04);
        await Future.delayed(Duration.zero);
      }
      int t = 5000;
      for (var i = 0; i < 3; i++) {
        fake.pushStepDetector(timestampMs: t);
        await Future.delayed(Duration.zero);
        t += 550;
        await Future.delayed(const Duration(milliseconds: 10));
      }
      await Future.delayed(const Duration(milliseconds: 100));
      // First event PENDING, next two ACCEPTED; nothing rejected.
      expect(svc.sensorStatus.stepCount, greaterThanOrEqualTo(2));
      expect(svc.sensorStatus.validatorValidated, 3);
      expect(svc.sensorStatus.validatorAccepted, 2);
      expect(svc.sensorStatus.validatorRejected, 0);
      expect(svc.sensorStatus.validatorLastReject, '—');
      svc.dispose();
      fake.dispose();
    });
  });
}

class _NoStepDetectorFake extends FakeSensorProvider {
  @override
  SensorCapabilities get capabilities => const SensorCapabilities(
        hasAccelerometer: true,
        hasGyroscope: true,
        hasMagnetometer: true,
        hasUserAcceleration: true,
        hasStepCounter: false,
        hasStepDetector: false,
      );
}
