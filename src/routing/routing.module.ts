import { Module } from '@nestjs/common';
import { TopicResolutionService } from './topic-resolution.service';

@Module({
  providers: [TopicResolutionService],
  exports: [TopicResolutionService],
})
export class RoutingModule {}
