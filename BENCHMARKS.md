# Bulk Stage Move Benchmark Results

These are measured local results from the benchmark runner, not projections.
Both runs completed with a 50,000-item snapshot and passed the runner's
correctness checks.

## Results

The recorded runs used the following commands:

```bash
BENCHMARK_ALLOW_DATA_MUTATION=YES \
BENCHMARK_DATABASE_NAME=opportunity_db \
BENCHMARK_OUTPUT=benchmark-results/uninterrupted.json \
npm run benchmark -- --source-stage=1 --destination-stage=2

BENCHMARK_ALLOW_DATA_MUTATION=YES \
BENCHMARK_DATABASE_NAME=opportunity_db \
BENCHMARK_OUTPUT=benchmark-results/kill-resume.json \
npm run benchmark -- --source-stage=3 --destination-stage=4 --crash-at=30000
```

### Uninterrupted 50,000-opportunity move

| Metric                       |                      Result |
| ---------------------------- | --------------------------: |
| Snapshot size                |                      50,000 |
| End-to-end elapsed time      | 73,454.4 ms (about 73.45 s) |
| Effective average throughput |      680.69 opportunities/s |
| Moved                        |                      50,000 |
| Conflicts                    |                           0 |
| Already at destination       |                           0 |
| Membership mismatch          |                           0 |
| Wrong destination stage      |                           0 |
| Transition count mismatch    |                           0 |
| Final status                 |                 `completed` |

Elapsed time is measured by the runner from immediately before submitting the
bulk-move HTTP request until a progress poll observes `completed`. It therefore
includes the submission request/response, background processing, and progress
polling (including the polling delay); it excludes benchmark-record tagging
before submission and the final correctness-query time. Throughput is
`moved_count / elapsedMs * 1000`, so this is an end-to-end average, not a
per-chunk or instantaneous rate.

### Interactive requests during bulk processing

The runner sent list requests to the bulk job's workspace and a different
workspace. The actual endpoint was
`GET /pipelines/{pipelineId}/opportunities?stageId={stageId}&limit=10`, with
`X-Workspace-Id` set for each target workspace. Each workspace had two
concurrent closed-loop clients. In this implementation, load sampling starts
immediately before job submission and stops after completion has been observed
and in-flight list requests have drained, so the measured load interval
slightly brackets the job rather than being clipped exactly to its processing
interval.

| Run             | Workspace           | Requests | Rate (requests/s) |     p50 |     p95 |     p99 | Failures |      Maximum |
| --------------- | ------------------- | -------: | ----------------: | ------: | ------: | ------: | -------: | -----------: |
| Uninterrupted   | Same as bulk job    |   77,071 |          1,049.18 | 1.63 ms | 3.00 ms | 7.33 ms |        0 |    105.47 ms |
| Uninterrupted   | Different workspace |   77,529 |          1,055.41 | 1.62 ms | 2.99 ms | 7.24 ms |        0 |     89.72 ms |
| Kill-and-resume | Same as bulk job    |   92,354 |            926.97 | 1.62 ms | 2.81 ms | 6.32 ms |        0 | 12,268.75 ms |
| Kill-and-resume | Different workspace |   92,718 |            930.62 | 1.61 ms | 2.78 ms | 6.33 ms |        0 | 12,268.66 ms |

The recovery run's maximum latencies of approximately 12.27 seconds are
unusually high compared with its p95/p99 and the uninterrupted maxima. They
are reported as measured; this benchmark does not identify their cause.

This is a closed-loop workload: each client sends its next request after the
previous request completes. Request rates are total attempts divided by the
shared load interval; latency percentiles and maxima use successful requests,
and failures are counted separately. It is not a fixed-arrival-rate test.
These rates describe this workload and environment only; they are not a
capacity guarantee or a production throughput estimate.

### Worker kill and resume

| Metric                                           |                       Result |
| ------------------------------------------------ | ---------------------------: |
| Termination method                               |                    `SIGKILL` |
| Old worker exit explicitly verified              |                          Yes |
| Worker explicitly restarted and running verified |                          Yes |
| Requested kill threshold                         |     30,000 committed records |
| Committed progress observed at kill              |                       30,600 |
| Snapshot size                                    |                       50,000 |
| Crash/restart procedure to completion            | 55,275.26 ms (about 55.28 s) |
| Total end-to-end elapsed time                    | 99,627.18 ms (about 99.63 s) |
| Effective average throughput                     |       501.87 opportunities/s |
| Moved                                            |                       50,000 |
| Conflicts                                        |                            0 |
| Already at destination                           |                            0 |
| Membership mismatch                              |                            0 |
| Wrong destination stage                          |                            0 |
| Transition count mismatch                        |                            0 |
| Final status                                     |                  `completed` |

The runner observes persisted progress by polling. The worker can commit more
items after the last observed progress and before the runner sends `SIGKILL`;
the worker processes chunks of 100, so the observed kill point can exceed the
requested threshold. Here the runner requested 30,000 and observed 30,600.

The **55,275.26 ms recovery duration** starts immediately before the runner
enters its kill/restart helper. It therefore includes the helper's worker
container lookup and restart-policy update, the `SIGKILL`, verification that
the worker exited, the explicit restart, and subsequent waiting until a
progress poll observes completion. It does not start at the exact instant
`SIGKILL` is sent. The **99,627.18 ms total elapsed time** starts before job
submission and ends when completion is observed; it includes the pre-crash
processing as well as recovery. These are different measurements.

## Method and correctness checks

The benchmark dataset has 500,000 opportunities in the main pipeline, 100 in
the main workspace's expansion pipeline, and 3,000 in each of five other
workspaces. The runner selects exactly 50,000 untouched seeded opportunities
from the specified main-workspace pipeline and source stage, tags them with a
unique run-specific owner, then submits a bulk-move job filtered by that source
stage and owner. Tagging is transactional and rolls back unless exactly 50,000
rows are selected. The uninterrupted run used stage 1 to stage 2; the recovery
run used stage 3 to stage 4. The runner submitted jobs through
`POST /pipelines/{pipelineId}/opportunity-bulk-moves` and polled
`GET /pipelines/{pipelineId}/opportunity-bulk-moves/{jobId}`.

For each completed run, the runner verifies that the persisted job snapshot
contains 50,000 items, all 50,000 have outcome `moved`, there are no conflict
or already-at-destination outcomes, every item still identifies the
benchmark-tagged opportunity in the expected pipeline, and each moved record
is at the destination stage. It records per-opportunity counts of matching
source-to-destination transitions before processing, then verifies that the
count increased by exactly one for every moved opportunity. This delta-based
check distinguishes transitions created by this run from historical matching
transitions. All reported mismatch counts were zero.

For recovery, the runner disables the worker container's automatic restart,
sends `SIGKILL`, polls Docker to verify that the original worker container has
exited, checks that the job is still nonterminal, explicitly starts the worker,
and verifies that it is running before waiting for job completion. The
reported final correctness checks also passed after recovery.

## Environment and configuration

| Item                             | Recorded value                                                               |
| -------------------------------- | ---------------------------------------------------------------------------- |
| OS                               | Darwin 24.6.0                                                                |
| Architecture                     | arm64                                                                        |
| CPU                              | Apple M1, 8 cores                                                            |
| Host RAM                         | 16 GiB                                                                       |
| Node.js                          | v24.22.1                                                                     |
| Worker chunk size                | 100                                                                          |
| Worker lease duration            | 30 seconds                                                                   |
| Worker maximum attempts          | 8                                                                            |
| Worker chunk pause               | 50 ms                                                                        |
| Worker poll interval             | 500 ms                                                                       |
| Compose PostgreSQL image         | `postgres:16-alpine`                                                         |
| Exact PostgreSQL server version  | Not recorded in the benchmark reports                                        |
| Docker Desktop CPU allocation    | Not recorded                                                                 |
| Docker Desktop memory allocation | Not recorded; the 16 GiB value above is host memory, not Docker's allocation |
| PostgreSQL runtime configuration | Not recorded                                                                 |

The Compose file specifies the `postgres:16-alpine` image but does not record
the exact PostgreSQL patch version, Docker Desktop resource allocation, or
PostgreSQL runtime settings for these runs.

## Limitations

These measurements were taken on one local Apple M1 machine using Docker
Compose. They do not represent a production deployment, distributed load
generator, or a controlled fixed-rate test. Docker Desktop resource allocation
and PostgreSQL runtime configuration were not captured, which limits
reproducibility. The results should not be used to claim production-scale
capacity or guaranteed isolation under arbitrary concurrent tenant workloads.

## Source reports

- [`benchmark-results/uninterrupted.json`](./benchmark-results/uninterrupted.json)
- [`benchmark-results/kill-resume.json`](./benchmark-results/kill-resume.json)
