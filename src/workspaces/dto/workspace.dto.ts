import { IsString, IsNotEmpty, IsEmail } from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  name: string;

}

export class AddMemberDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
