import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:real_life_amongus_app/core/models/game_map.dart';
import 'package:real_life_amongus_app/core/models/position_estimate.dart';
import 'package:real_life_amongus_app/core/positioning/positioning_service.dart';
import 'package:real_life_amongus_app/core/positioning/sensor_provider.dart';
import 'package:real_life_amongus_app/features/map/presentation/heading_arrow.dart';

class DiagnosticsPanel extends StatelessWidget {
  const DiagnosticsPanel({
    required this.currentPosition,
    required this.gameMap,
    required this.sensorStatus,
    required this.stepLog,
    required this.onCalibrate,
    required this.onResetPosition,
    super.key,
  });

  final PositionEstimate? currentPosition;
  final GameMapData? gameMap;
  final SensorStatus? sensorStatus;
  final List<dynamic> stepLog;
  final VoidCallback? onCalibrate;
  final VoidCallback onResetPosition;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final colorScheme = Theme.of(context).colorScheme;
    final s = sensorStatus;
    // Arrow heading is live (fused heading, updates without steps),
    // falling back to the last estimate heading when fusion has no value.
    final double? arrowHeading = s?.headingDeg ?? currentPosition?.heading;
    String fmt(double? v, [int d = 2]) => v == null ? '--' : v.toStringAsFixed(d);
    String fmtInt(int? v) => v == null ? '--' : v.toString();
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest,
        border: Border(top: BorderSide(color: colorScheme.outlineVariant)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Text('Position Diagnostics', style: textTheme.titleSmall),
              const Spacer(),
              FilledButton.tonalIcon(
                onPressed: onResetPosition,
                icon: const Icon(Icons.refresh, size: 14),
                label: const Text('RESET', style: TextStyle(fontSize: 10)),
                style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4)),
              ),
              if (onCalibrate != null)
                TextButton.icon(
                  onPressed: onCalibrate,
                  icon: const Icon(Icons.straighten, size: 14),
                  label: const Text('Cal', style: TextStyle(fontSize: 10)),
                ),
            ],
          ),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              key: const Key('copy-test-data-button'),
              onPressed: () {
                final buf = StringBuffer();
                buf.writeln('BUILD: ${s?.buildVersion ?? '--'}');
                buf.writeln('MOTION: ${s?.motionState?.name.toUpperCase() ?? '--'}');
                buf.writeln('HW_STEPS: ${s?.hardwareStepCount ?? '--'}');
                buf.writeln('TOTAL_STEPS: ${s?.stepCount ?? '--'}');
                buf.writeln('VALIDATOR: ${s?.lastStepReason ?? '--'}');
                buf.writeln('WALK_CONF: ${s?.walkingConfidence == null ? '--' : s!.walkingConfidence!.toStringAsFixed(2)}');
                buf.writeln('HEADING: ${s?.headingDeg == null ? '--' : '${s!.headingDeg!.toStringAsFixed(1)}°'}');
                buf.writeln('RAW_HEADING: ${s?.headingRaw == null ? '--' : '${s!.headingRaw!.toStringAsFixed(1)}°'}');
                buf.writeln('PDR: x=${currentPosition?.x.toStringAsFixed(2) ?? '--'} y=${currentPosition?.y.toStringAsFixed(2) ?? '--'}');
                buf.writeln('DISTANCE: ${s == null ? '--' : '${s.totalDistance.toStringAsFixed(2)}m'}');
                buf.writeln('LAST_STEP: dx=${s?.pdrDx?.toStringAsFixed(2) ?? '--'} dy=${s?.pdrDy?.toStringAsFixed(2) ?? '--'} stride=${s?.lastStride?.toStringAsFixed(3) ?? '--'}');
                if (stepLog.isEmpty) {
                  buf.writeln('STEP_LOG: empty');
                } else {
                  final last5 = stepLog.reversed.take(5).toList().reversed.toList();
                  for (var i = 0; i < last5.length; i++) {
                    final d = last5[i] as dynamic;
                    buf.writeln('STEP_${i+1}: heading=${d.headingDeg.toStringAsFixed(0)}° dx=${d.dx.toStringAsFixed(2)} dy=${d.dy.toStringAsFixed(2)} x=${d.worldX.toStringAsFixed(1)} y=${d.worldY.toStringAsFixed(1)}');
                  }
                }
                Clipboard.setData(ClipboardData(text: buf.toString()));
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Test data copied to clipboard'), duration: Duration(seconds: 2)));
              },
              icon: const Icon(Icons.copy, size: 14),
              label: const Text('Copy Test Data', style: TextStyle(fontSize: 10)),
              style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4)),
            ),
          ),
          _DiagnosticRow(label: 'Build', value: s?.buildVersion ?? '--'),
          _DiagnosticRow(label: 'Source', value: currentPosition?.source.toWire() ?? '--'),
          const SizedBox(height: 4),
          Text('1. STEP_DETECTOR', style: textTheme.labelSmall?.copyWith(fontWeight: FontWeight.bold)),
          _DiagnosticRow(label: 'supported', value: (s?.capabilities.hasStepDetector == true) ? 'yes' : 'no'),
          _DiagnosticRow(label: 'useHardware', value: s?.useHardwareStepDetector == true ? 'HARDWARE' : 'FALLBACK'),
          _DiagnosticRow(label: 'fallback', value: (s?.fallbackActive == true) ? 'ACTIVE(${(s?.failoverReason ?? '?')})' : '--'),
          _DiagnosticRow(label: 'hwError', value: s?.stepDetectorError ?? '--'),
          _DiagnosticRow(label: 'hwSteps', value: fmtInt(s?.hardwareStepCount)),
          _DiagnosticRow(label: 'accel', value: fmtInt(s?.accelSamples)),
          _DiagnosticRow(label: 'fbRead', value: fmtInt(s?.fallbackSamples)),
          _DiagnosticRow(label: 'lastHwTime', value: s?.lastHardwareStepTime == null || s!.lastHardwareStepTime == 0 ? '--' : '${s.lastHardwareStepTime}'),
          _DiagnosticRow(label: 'totalSteps', value: fmtInt(s?.stepCount)),
          const Divider(height: 10),
          Text('2. MOTION', style: textTheme.labelSmall?.copyWith(fontWeight: FontWeight.bold)),
          _DiagnosticRow(label: 'state', value: s?.motionState?.name.toUpperCase() ?? '--'),
          _DiagnosticRow(label: 'accMean', value: fmt(s?.motionAccelMean, 3)),
          _DiagnosticRow(label: 'accVar', value: fmt(s?.motionAccelVar, 4)),
          _DiagnosticRow(label: 'gyroMean', value: fmt(s?.motionGyroMean, 4)),
          _DiagnosticRow(label: 'gyroVar', value: fmt(s?.motionGyroVar, 5)),
          const Divider(height: 10),
          Text('3. WALKING VALIDATOR', style: textTheme.labelSmall?.copyWith(fontWeight: FontWeight.bold)),
          _DiagnosticRow(
            label: 'val',
            value: 'A=${fmtInt(s?.validatorAccepted)} R=${fmtInt(s?.validatorRejected)}'
                ' (${s?.validatorLastReject ?? '--'})',
          ),
          _DiagnosticRow(label: 'reason', value: s?.lastStepReason ?? '--'),
          _DiagnosticRow(label: 'consecutive', value: fmtInt(s?.validatorConsecutive)),
          _DiagnosticRow(label: 'interval', value: s?.lastIntervalMs == null ? '--' : '${s!.lastIntervalMs}ms'),
          _DiagnosticRow(label: 'walkConf', value: fmt(s?.walkingConfidence, 2)),
          const Divider(height: 10),
          Text('4. HEADING', style: textTheme.labelSmall?.copyWith(fontWeight: FontWeight.bold)),
          _DiagnosticRow(label: 'fused', value: s?.headingDeg == null ? '--' : '${s!.headingDeg!.toStringAsFixed(1)}°'),
          _DiagnosticRow(label: 'rawMag', value: s?.headingRaw == null ? '--' : '${s!.headingRaw!.toStringAsFixed(1)}°'),
          _DiagnosticRow(label: 'conf', value: fmt(s?.headingConfidence, 2)),
          _DiagnosticRow(label: 'gyroDelta', value: s?.gyroDeltaDeg == null ? '--' : '${s!.gyroDeltaDeg!.toStringAsFixed(2)}°'),
          _DiagnosticRow(label: 'mag', value: s?.magX == null ? '--' : '(${s!.magX!.toStringAsFixed(1)}, ${s!.magY!.toStringAsFixed(1)}, ${s!.magZ!.toStringAsFixed(1)})'),
          const Divider(height: 10),
          Text('5. PDR', style: textTheme.labelSmall?.copyWith(fontWeight: FontWeight.bold)),
          _DiagnosticRow(label: 'world', value: currentPosition == null ? '--' : '(${currentPosition!.x.toStringAsFixed(2)}, ${currentPosition!.y.toStringAsFixed(2)})'),
          _DiagnosticRow(label: 'last dx/dy', value: s?.pdrDx == null ? '--' : '(${s!.pdrDx!.toStringAsFixed(2)}, ${s!.pdrDy!.toStringAsFixed(2)})'),
          _DiagnosticRow(label: 'stride', value: fmt(s?.lastStride, 3)),
          _DiagnosticRow(label: 'steps', value: fmtInt(s?.stepCount)),
          _DiagnosticRow(label: 'distance', value: s == null ? '--' : '${s.totalDistance.toStringAsFixed(2)}m'),
          _DiagnosticRow(
            label: 'cand/rej',
            value: '${fmtInt(s?.pdrCandidates)}/${fmtInt(s?.pdrRejected)}'
                ' (${s?.pdrLastReject ?? '--'})',
          ),
          _DiagnosticRow(
            label: 'filt/raw',
            value: '${fmt(s?.pdrLastFilt, 2)}/${fmt(s?.pdrLastRaw, 2)}',
          ),
          _DiagnosticRow(
            label: 'ts',
            value: 'cand=${s?.pdrLastCandidateTs ?? '--'} '
                'acc=${s?.lastAcceptedStepMs ?? '--'}',
          ),
          const Divider(height: 10),
          Text('6. RAW SENSORS', style: textTheme.labelSmall?.copyWith(fontWeight: FontWeight.bold)),
          _DiagnosticRow(label: 'uAcc', value: s?.lastUserAccel == null ? '--' : '(${s!.lastUserAccel!.x.toStringAsFixed(2)}, ${s!.lastUserAccel!.y.toStringAsFixed(2)}, ${s!.lastUserAccel!.z.toStringAsFixed(2)})'),
          _DiagnosticRow(label: 'acc', value: s?.lastAccel == null ? '--' : '(${s!.lastAccel!.x.toStringAsFixed(2)}, ${s!.lastAccel!.y.toStringAsFixed(2)}, ${s!.lastAccel!.z.toStringAsFixed(2)})'),
          _DiagnosticRow(label: 'gyro', value: s?.lastGyro == null ? '--' : '(${s!.lastGyro!.x.toStringAsFixed(2)}, ${s!.lastGyro!.y.toStringAsFixed(2)}, ${s!.lastGyro!.z.toStringAsFixed(2)})'),
          _DiagnosticRow(label: 'mag', value: s?.lastMag == null ? '--' : '(${s!.lastMag!.x.toStringAsFixed(1)}, ${s!.lastMag!.y.toStringAsFixed(1)}, ${s!.lastMag!.z.toStringAsFixed(1)})'),
          const Divider(height: 10),
          Text('7. MAP', style: textTheme.labelSmall?.copyWith(fontWeight: FontWeight.bold)),
          _DiagnosticRow(label: 'world', value: currentPosition == null ? '--' : '(${currentPosition!.x.toStringAsFixed(2)}, ${currentPosition!.y.toStringAsFixed(2)})'),
          _DiagnosticRow(label: 'screen', value: currentPosition == null ? '--' : '(${(currentPosition!.x*8).toStringAsFixed(0)}, ${(currentPosition!.y*8).toStringAsFixed(0)}) px @8ppm'),
          _DiagnosticRow(label: 'ppm', value: '8.0 (dynamic)'),
          _DiagnosticRow(label: 'origin', value: 'auto-centered'),
          _DiagnosticRow(label: 'headingPos', value: s?.headingDeg == null ? '--' : '${s!.headingDeg!.toStringAsFixed(1)}°'),
          _DiagnosticRow(
            label: 'ARROW',
            value: currentPosition == null
                ? '--'
                : 'heading=${arrowHeading == null ? '--' : '${arrowHeading.toStringAsFixed(0)}°'} '
                    'position=(${currentPosition!.x.toStringAsFixed(1)},${currentPosition!.y.toStringAsFixed(1)})',
          ),
          _DiagnosticRow(
            label: 'ARROW_DIR',
            value: arrowHeading == null
                ? '--'
                : () {
                    final dir = headingDirection(arrowHeading);
                    String f2(double v) => (v.abs() < 5e-4 ? 0.0 : v).toStringAsFixed(2);
                    return 'dx=${f2(dir.dx)} dy=${f2(dir.dy)}';
                  }(),
          ),
          Text('Map: ${gameMap?.nodes.length ?? 0} nodes, ${gameMap?.corridors.length ?? 0} corridors, ${gameMap?.rooms.length ?? 0} rooms', style: textTheme.bodySmall),
          const Divider(height: 10),
          Text('STEP LOG (last ${stepLog.length})', style: textTheme.labelSmall?.copyWith(fontWeight: FontWeight.bold)),
          if (stepLog.isEmpty)
            Text('— no accepted steps yet —', style: textTheme.bodySmall)
          else
            ...stepLog.reversed.take(8).map((e) {
              final d = e as dynamic;
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 1),
                child: Text(
                  'STEP #${d.stepNumber} h=${d.headingDeg.toStringAsFixed(0)}° s=${d.stride.toStringAsFixed(2)} dx=${d.dx.toStringAsFixed(2)} dy=${d.dy.toStringAsFixed(2)} world=(${d.worldX.toStringAsFixed(1)},${d.worldY.toStringAsFixed(1)}) ${d.motionState.name} ${d.validatorReason}',
                  style: textTheme.labelSmall?.copyWith(fontFamily: 'monospace', fontSize: 9),
                ),
              );
            }),
        ],
      ),
    );
  }
}

class _DiagnosticRow extends StatelessWidget {
  const _DiagnosticRow({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(width: 100, child: Text(label, style: Theme.of(context).textTheme.bodySmall)),
          Expanded(child: Text(value, style: Theme.of(context).textTheme.bodyMedium, overflow: TextOverflow.ellipsis)),
        ],
      ),
    );
  }
}
