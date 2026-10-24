# Lulu replay report

Generated 2026-10-24T07:21:41.145Z from 11 clips.

## Recorded clips

Model outputs recorded on a camera phone or extracted from real video, so these numbers include detector and classifier error.

_No clips yet._

## Synthetic clips (logic checks)

Simulated detector output with noise, dropouts and distractors. These check the alert rules end to end, not model accuracy.

11 clips, 64 minutes in total.

| Alert | Labelled | Caught | Missed | False alarms | False alarms / hr | Recall | Precision | Median delay |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Crying | 1 | 1 | 0 | 0 | 0.00 | 100% | 100% | 4.0s |
| Near zone edge | 2 | 2 | 0 | 0 | 0.00 | 100% | 100% | 1.0s |
| Left safe zone | 2 | 2 | 0 | 0 | 0.00 | 100% | 100% | 1.7s |
| Sat up | 2 | 2 | 0 | 0 | 0.00 | 100% | 100% | 3.2s |
| Rolled over | 1 | 1 | 0 | 0 | 0.00 | 100% | 100% | 4.4s |
| Object nearby | 1 | 1 | 0 | 0 | 0.00 | 100% | 100% | 0.4s |
| Camera blocked | 1 | 1 | 0 | 0 | 0.00 | 100% | 100% | 5.0s |
| Too dark | 1 | 1 | 0 | 0 | 0.00 | 100% | 100% | 10.0s |
| Camera moved | 1 | 1 | 0 | 0 | 0.00 | 100% | 100% | 3.0s |
| **All** | 12 | 12 | 0 | 0 | 0.00 | 100% | | |

| | Clip | Length | Caught | False alarms | Scenario |
|---|---|---:|---:|---:|---|
| ✅ | `synthetic-camera-bumped` | 3 min | 1/1 | 0 | The camera phone is knocked at 90 s and now points elsewhere. |
| ✅ | `synthetic-climb-out` | 3 min | 3/3 | 0 | A toddler moves to the side of the crib and climbs out. |
| ✅ | `synthetic-cry-episode` | 5 min | 1/1 | 0 | Baby wakes and cries on and off for 90 s. Two coughs beforehand should not alert. |
| ✅ | `synthetic-daycare-two-children` | 5 min | 2/2 | 0 | Two children on a play mat; one crawls off at ~150 s while staff walk past twice. |
| ✅ | `synthetic-lens-covered` | 3 min | 1/1 | 0 | A blanket covers the lens for 40 s. |
| ✅ | `synthetic-lights-off` | 3 min | 1/1 | 0 | Room lights go off with no night light. |
| ✅ | `synthetic-parent-pickup` | 3 min | 0/0 | 0 | A parent walks in, stands at the crib and lifts the baby out. Nothing should alert. |
| ✅ | `synthetic-quiet-night` | 30 min | 0/0 | 0 | 30 minutes of a sleeping baby with a cough, a passing adult and detector noise. Nothing should alert. |
| ✅ | `synthetic-roll-over` | 3 min | 1/1 | 0 | Baby rolls onto their tummy at 80 s and stays there. |
| ✅ | `synthetic-scissors-nearby` | 3 min | 1/1 | 0 | Scissors are left beside the baby (flickering detection). A knife on a far table should not alert. |
| ✅ | `synthetic-sit-up` | 3 min | 1/1 | 0 | Baby sits up for 30 s, then lies back down. |

### False alarms and misses

_None._
