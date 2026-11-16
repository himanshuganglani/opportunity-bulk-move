import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
@ApiTags('Application')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Get the application greeting' })
  @ApiOkResponse({
    description: 'Welcome message for the Opportunity Bulk Move API.',
    schema: {
      type: 'string',
      example: 'Welcome to the Opportunity Bulk Move API!',
    },
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
