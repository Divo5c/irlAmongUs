package com.example.real_life_amongus_app

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel

class MainActivity : FlutterActivity() {
    private var sensorManager: SensorManager? = null
    private var stepDetectorSensor: Sensor? = null
    private var stepDetectorListener: SensorEventListener? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        EventChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "com.example.real_life_amongus_app/step_detector"
        ).setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
                    stepDetectorSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
                    if (stepDetectorSensor == null) {
                        events?.error("UNAVAILABLE", "Step detector not available", null)
                        return
                    }
                    stepDetectorListener = object : SensorEventListener {
                        override fun onSensorChanged(event: SensorEvent?) {
                            if (event?.sensor?.type == Sensor.TYPE_STEP_DETECTOR) {
                                val ts = System.currentTimeMillis()
                                events?.success(mapOf("value" to event.values[0], "timestamp" to ts))
                            }
                        }
                        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
                    }
                    sensorManager?.registerListener(
                        stepDetectorListener,
                        stepDetectorSensor,
                        SensorManager.SENSOR_DELAY_GAME
                    )
                }

                override fun onCancel(arguments: Any?) {
                    if (stepDetectorListener != null) {
                        sensorManager?.unregisterListener(stepDetectorListener)
                    }
                    stepDetectorListener = null
                }
            }
        )
    }
}
