import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminTemplateImagesController,
  PublicTemplateImagesController,
} from './template-images.controller';
import { TemplateImagesService } from './template-images.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminTemplateImagesController, PublicTemplateImagesController],
  providers: [TemplateImagesService],
  exports: [TemplateImagesService],
})
export class TemplateImagesModule {}
