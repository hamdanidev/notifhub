import { Injectable, OnModuleDestroy } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { PinoLogger } from 'nestjs-pino';
import {
  ProviderUnavailableError,
  type NotificationProvider,
  type ProviderSendInput,
  type ProviderSendResult,
} from './provider.interface';

const BREAKER_TIMEOUT_MS = 10_000;
const BREAKER_ERROR_THRESHOLD_PERCENT = 50;
const BREAKER_RESET_TIMEOUT_MS = 30_000;
const BREAKER_ROLLING_WINDOW_MS = 10_000;
const BREAKER_VOLUME_THRESHOLD = 5;

type ProviderBreaker = CircuitBreaker<[ProviderSendInput], ProviderSendResult>;

/**
 * Wraps every provider call in an opossum circuit breaker (PART 1 rule 17).
 *
 * The breaker opens after repeated provider failures, which makes the worker fail fast and
 * lets BullMQ retry with exponential backoff instead of hammering a broken provider.
 * Retry itself stays with BullMQ; providers do not implement their own retry loop.
 */
@Injectable()
export class ProviderExecutor implements OnModuleDestroy {
  private readonly breakers = new Map<string, ProviderBreaker>();

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ProviderExecutor.name);
  }

  async execute(
    provider: NotificationProvider,
    input: ProviderSendInput,
  ): Promise<ProviderSendResult> {
    const breaker = this.getBreaker(provider);

    try {
      return await breaker.fire(input);
    } catch (error) {
      if (breaker.opened) {
        throw new ProviderUnavailableError(
          `circuit breaker is open for provider ${provider.name} (${provider.channel})`,
        );
      }

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const breaker of this.breakers.values()) {
      breaker.shutdown();
    }

    this.breakers.clear();
  }

  private getBreaker(provider: NotificationProvider): ProviderBreaker {
    const key = `${provider.channel}:${provider.name}`;
    const existing = this.breakers.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const breaker = new CircuitBreaker<[ProviderSendInput], ProviderSendResult>(
      (input) => provider.send(input),
      {
        timeout: BREAKER_TIMEOUT_MS,
        errorThresholdPercentage: BREAKER_ERROR_THRESHOLD_PERCENT,
        resetTimeout: BREAKER_RESET_TIMEOUT_MS,
        rollingCountTimeout: BREAKER_ROLLING_WINDOW_MS,
        volumeThreshold: BREAKER_VOLUME_THRESHOLD,
      },
    );

    breaker.on('open', () => {
      this.logger.warn(
        { event: 'provider.circuit.open', provider: provider.name, channel: provider.channel },
        'provider circuit breaker opened',
      );
    });

    breaker.on('halfOpen', () => {
      this.logger.info(
        { event: 'provider.circuit.half_open', provider: provider.name, channel: provider.channel },
        'provider circuit breaker half-open, probing the provider',
      );
    });

    breaker.on('close', () => {
      this.logger.info(
        { event: 'provider.circuit.closed', provider: provider.name, channel: provider.channel },
        'provider circuit breaker closed',
      );
    });

    breaker.on('timeout', () => {
      this.logger.warn(
        {
          event: 'provider.circuit.timeout',
          provider: provider.name,
          channel: provider.channel,
          timeout_ms: BREAKER_TIMEOUT_MS,
        },
        'provider call timed out',
      );
    });

    this.breakers.set(key, breaker);

    return breaker;
  }
}
