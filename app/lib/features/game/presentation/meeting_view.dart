import 'dart:async';

import 'package:flutter/material.dart';

/// Phase-aware meeting view:
/// DISCUSSION -> countdown + info (no voting UI)
/// VOTING     -> vote buttons, skip, live progress
/// result     -> outcome panel with optional tally + continue
class MeetingView extends StatefulWidget {
  const MeetingView({
    required this.players,
    required this.playerId,
    required this.onVote,
    required this.onSkip,
    required this.onContinue,
    this.phase = 'VOTING',
    this.reporterId,
    this.discussionDeadlineMs,
    this.votingDeadlineMs,
    this.votedCount = 0,
    this.totalVoters = 0,
    this.canVote = false,
    this.result,
    super.key,
  });

  final List<Map<String, dynamic>> players;
  final String playerId;

  /// 'DISCUSSION' or 'VOTING' (server-authoritative meeting phase).
  final String phase;

  final String? reporterId;
  final int? discussionDeadlineMs;
  final int? votingDeadlineMs;
  final int votedCount;
  final int totalVoters;

  /// Whether the local player may vote (alive and in the room).
  final bool canVote;

  /// Non-null once the server announced the meeting result.
  final Map<String, dynamic>? result;

  final void Function(String targetId) onVote;
  final VoidCallback onSkip;
  final VoidCallback onContinue;

  @override
  State<MeetingView> createState() => _MeetingViewState();
}

class _MeetingViewState extends State<MeetingView> {
  Timer? _ticker;
  bool _hasVoted = false;
  DateTime? _discussionDeadline;
  DateTime? _votingDeadline;

  @override
  void initState() {
    super.initState();
    _resolveDeadlines();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() {}); // refresh countdowns every second
      }
    });
  }

  @override
  void didUpdateWidget(MeetingView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.discussionDeadlineMs != oldWidget.discussionDeadlineMs ||
        widget.votingDeadlineMs != oldWidget.votingDeadlineMs) {
      _resolveDeadlines();
    }
    if (widget.result != null && oldWidget.result == null) {
      _hasVoted = true; // meeting finished; freeze the voting UI
    }
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  void _resolveDeadlines() {
    final discussion = widget.discussionDeadlineMs;
    final voting = widget.votingDeadlineMs;
    _discussionDeadline =
        discussion == null ? null : DateTime.fromMillisecondsSinceEpoch(discussion);
    _votingDeadline =
        voting == null ? null : DateTime.fromMillisecondsSinceEpoch(voting);
  }

  bool get _inDiscussion =>
      widget.result == null && widget.phase == 'DISCUSSION';

  bool _isAlive(Map<String, dynamic> player) => player['isAlive'] != false;

  String _nameOf(Map<String, dynamic> player) =>
      player['name'] is String && (player['name'] as String).isNotEmpty
          ? player['name'] as String
          : '${player['id']}';

  String _countdownText(DateTime? deadline) {
    if (deadline == null) {
      return '';
    }
    final remaining = deadline.difference(DateTime.now());
    if (remaining <= Duration.zero) {
      return '...';
    }
    final minutes = remaining.inMinutes;
    final seconds = remaining.inSeconds % 60;
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }

  List<String> _tallyLines(Map<String, dynamic> result) {
    final rawTally = result['tally'];
    if (rawTally is! Map) {
      return const [];
    }
    final entries = <MapEntry<String, int>>[];
    rawTally.forEach((key, value) {
      if (value is num) {
        entries.add(MapEntry('$key', value.toInt()));
      }
    });
    entries.sort((a, b) => b.value.compareTo(a.value));
    return [
      for (final entry in entries)
        entry.key == 'skip'
            ? 'Skip × ${entry.value}'
            : '${_nameForId(entry.key)} × ${entry.value}',
    ];
  }

  String _nameForId(String playerIdKey) {
    for (final player in widget.players) {
      if (player['id'] == playerIdKey) {
        return _nameOf(player);
      }
    }
    return playerIdKey;
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final result = widget.result;

    String? reporterName;
    for (final player in widget.players) {
      if (player['id'] == widget.reporterId &&
          player['name'] is String &&
          reporterName == null) {
        reporterName = player['name'] as String;
      }
    }

    Map<String, dynamic>? ejected;
    if (result != null && result['ejectedPlayerId'] is String) {
      final ejectedId = result['ejectedPlayerId'] as String;
      ejected = {'id': ejectedId};
      for (final player in widget.players) {
        if (player['id'] == ejectedId) {
          ejected = player;
          break;
        }
      }
    }

    final aliveOthers = widget.players
        .where(
          (player) =>
              player['id'] != widget.playerId && _isAlive(player),
        )
        .toList();

    return Center(
      child: SingleChildScrollView(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Icon(
                  result != null
                      ? Icons.gavel_rounded
                      : (_inDiscussion
                          ? Icons.forum_rounded
                          : Icons.how_to_vote_rounded),
                  size: 64,
                  color: colorScheme.primary,
                ),
                const SizedBox(height: 12),
                Text(
                  result != null
                      ? 'Meeting Result'
                      : (_inDiscussion ? 'Discussion' : 'Voting'),
                  textAlign: TextAlign.center,
                  style: textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                Text(
                  reporterName == null
                      ? 'A body was reported.'
                      : '$reporterName reported a body.',
                  textAlign: TextAlign.center,
                  style: textTheme.bodyLarge,
                ),
                const SizedBox(height: 20),
                if (result != null) ...[
                  Card(
                    color: ejected == null
                        ? null
                        : colorScheme.errorContainer,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          Text(
                            ejected == null
                                ? 'Nobody was ejected.'
                                : (result['confirmEjects'] == false
                                    ? 'Someone was ejected.'
                                    : '${_nameOf(ejected)} was ejected.'),
                            key: const Key('meeting-result-text'),
                            textAlign: TextAlign.center,
                            style: textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          for (final line in _tallyLines(result))
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text(line, style: textTheme.bodySmall),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    key: const Key('meeting-continue-button'),
                    onPressed: widget.onContinue,
                    child: const Text('Continue'),
                  ),
                ] else if (_inDiscussion) ...[
                  Text(
                    _countdownText(_discussionDeadline),
                    key: const Key('discussion-countdown'),
                    textAlign: TextAlign.center,
                    style: textTheme.displaySmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Talk to each other! Voting opens automatically.',
                    textAlign: TextAlign.center,
                    style: textTheme.bodyLarge,
                  ),
                ] else ...[
                  Text(
                    _countdownText(_votingDeadline),
                    key: const Key('vote-countdown'),
                    textAlign: TextAlign.center,
                    style: textTheme.displaySmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    widget.canVote
                        ? '${widget.votedCount} / ${widget.totalVoters} votes cast'
                        : 'You are watching this meeting.',
                    textAlign: TextAlign.center,
                    style: textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 12),
                  if (!widget.canVote)
                    const Text(
                      'Dead players cannot vote.',
                      textAlign: TextAlign.center,
                    )
                  else ...[
                    for (final player in aliveOthers)
                      Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          leading: const CircleAvatar(
                            child: Icon(Icons.person_outline, size: 20),
                          ),
                          title: Text(_nameOf(player)),
                          trailing: IconButton(
                            key: Key('vote-button-${player['id']}'),
                            tooltip: 'Vote for ${_nameOf(player)}',
                            icon: const Icon(Icons.how_to_vote_rounded),
                            onPressed: _hasVoted
                                ? null
                                : () {
                                    setState(() => _hasVoted = true);
                                    final targetId = player['id'];
                                    if (targetId is String) {
                                      widget.onVote(targetId);
                                    }
                                  },
                          ),
                        ),
                      ),
                    const SizedBox(height: 4),
                    OutlinedButton.icon(
                      key: const Key('skip-vote-button'),
                      onPressed: _hasVoted
                          ? null
                          : () {
                              setState(() => _hasVoted = true);
                              widget.onSkip();
                            },
                      icon: const Icon(Icons.skip_next_rounded),
                      label: const Text('Skip Vote'),
                    ),
                    if (_hasVoted) ...[
                      const SizedBox(height: 8),
                      Text(
                        'Vote cast. Waiting for the others...',
                        textAlign: TextAlign.center,
                        style: textTheme.bodySmall,
                      ),
                    ],
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
