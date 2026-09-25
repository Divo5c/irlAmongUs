import 'dart:math';

abstract final class RoomCode {
  static const length = 6;
  static const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  static final RegExp _validPattern = RegExp('^[A-Z2-9]{$length}\$');

  static String generate({Random? random}) {
    final generator = random ?? Random();

    return List.generate(
      length,
      (_) => characters[generator.nextInt(characters.length)],
    ).join();
  }

  static bool isValid(String value) => _validPattern.hasMatch(value);

  static String normalize(String value) {
    final normalized = value.toUpperCase().replaceAll(
      RegExp('[^$characters]'),
      '',
    );

    return normalized.substring(0, min(normalized.length, length));
  }
}
