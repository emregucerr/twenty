import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import FileType from 'file-type';
import { Repository } from 'typeorm';
import { v4 } from 'uuid';
import { isDefined } from 'class-validator';

import { FileFolder } from 'src/engine/core-modules/file/interfaces/file-folder.interface';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import {
  PASSWORD_REGEX,
  compareHash,
  hashPassword,
} from 'src/engine/core-modules/auth/auth.util';
import { FileUploadService } from 'src/engine/core-modules/file/file-upload/services/file-upload.service';
import { OnboardingService } from 'src/engine/core-modules/onboarding/onboarding.service';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { User } from 'src/engine/core-modules/user/user.entity';
import {
  Workspace,
  WorkspaceActivationStatus,
} from 'src/engine/core-modules/workspace/workspace.entity';
import { EnvironmentService } from 'src/engine/core-modules/environment/environment.service';
import { getImageBufferFromUrl } from 'src/utils/image';
import { workspaceValidator } from 'src/engine/core-modules/workspace/workspace.validate';
import { userValidator } from 'src/engine/core-modules/user/user.validate';

export type SignInUpServiceInput = {
  email: string;
  password?: string;
  firstName?: string | null;
  lastName?: string | null;
  workspaceInviteHash?: string | null;
  workspacePersonalInviteToken?: string | null;
  picture?: string | null;
  fromSSO: boolean;
  isAuthEnabled?: ReturnType<(typeof workspaceValidator)['isAuthEnabled']>;
};

@Injectable()
// eslint-disable-next-line @nx/workspace-inject-workspace-repository
export class SignInUpService {
  constructor(
    private readonly fileUploadService: FileUploadService,
    @InjectRepository(Workspace, 'core')
    private readonly workspaceRepository: Repository<Workspace>,
    @InjectRepository(User, 'core')
    private readonly userRepository: Repository<User>,
    private readonly userWorkspaceService: UserWorkspaceService,
    private readonly onboardingService: OnboardingService,
    private readonly httpService: HttpService,
    private readonly environmentService: EnvironmentService,
  ) {}

  async signInUp({
    email,
    workspaceInviteHash,
    workspacePersonalInviteToken,
    password,
    firstName,
    lastName,
    picture,
    fromSSO,
    isAuthEnabled,
  }: SignInUpServiceInput) {
    if (!firstName) firstName = '';
    if (!lastName) lastName = '';

    if (!email) {
      throw new AuthException(
        'Email is required',
        AuthExceptionCode.INVALID_INPUT,
      );
    }

    if (password) {
      const isPasswordValid = PASSWORD_REGEX.test(password);

      if (!isPasswordValid) {
        throw new AuthException(
          'Password too weak',
          AuthExceptionCode.INVALID_INPUT,
        );
      }
    }

    const passwordHash = password ? await hashPassword(password) : undefined;

    const existingUser = await this.userRepository.findOne({
      where: {
        email: email,
      },
      relations: ['defaultWorkspace'],
    });

    if (existingUser && !fromSSO) {
      const isValid = await compareHash(
        password || '',
        existingUser.passwordHash,
      );

      if (!isValid) {
        throw new AuthException(
          'Wrong password',
          AuthExceptionCode.FORBIDDEN_EXCEPTION,
        );
      }
    }

    if (workspaceInviteHash) {
      return await this.signInUpOnExistingWorkspace({
        email,
        passwordHash,
        workspaceInviteHash,
        workspacePersonalInviteToken,
        firstName,
        lastName,
        picture,
        existingUser,
        isAuthEnabled,
      });
    }
    if (!existingUser) {
      return await this.signUpOnNewWorkspace({
        email,
        passwordHash,
        firstName,
        lastName,
        picture,
      });
    }

    return existingUser;
  }

  private async signInUpOnExistingWorkspace({
    email,
    passwordHash,
    workspaceInviteHash,
    workspacePersonalInviteToken,
    firstName,
    lastName,
    picture,
    existingUser,
    isAuthEnabled,
  }: {
    email: string;
    passwordHash: string | undefined;
    workspaceInviteHash: string | null;
    workspacePersonalInviteToken: string | null | undefined;
    firstName: string;
    lastName: string;
    picture: SignInUpServiceInput['picture'];
    existingUser: User | null;
    isAuthEnabled?: ReturnType<(typeof workspaceValidator)['isAuthEnabled']>;
  }) {
    const isNewUser = !isDefined(existingUser);
    let user = existingUser;

    const workspace = await this.findWorkspaceAndValidateInvitation({
      workspacePersonalInviteToken,
      workspaceInviteHash,
      email,
    });

    workspaceValidator.assertIsExist(
      workspace,
      new AuthException(
        'Workspace not found',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      ),
    );

    workspaceValidator.assertIsActive(
      workspace,
      new AuthException(
        'Workspace is not ready to welcome new members',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      ),
    );

    if (isAuthEnabled)
      workspaceValidator.validateAuth(isAuthEnabled, workspace);

    if (isNewUser) {
      const imagePath = await this.uploadPicture(picture, workspace.id);

      const userToCreate = this.userRepository.create({
        email: email,
        firstName: firstName,
        lastName: lastName,
        defaultAvatarUrl: imagePath,
        canImpersonate: false,
        passwordHash,
        defaultWorkspace: workspace,
      });

      user = await this.userRepository.save(userToCreate);
    }

    userValidator.assertIsExist(
      user,
      new AuthException(
        'User not found',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      ),
    );

    const updatedUser = workspacePersonalInviteToken
      ? await this.userWorkspaceService.addUserToWorkspaceByInviteToken(
          workspacePersonalInviteToken,
          user,
        )
      : await this.userWorkspaceService.addUserToWorkspace(user, workspace);

    await this.activateOnboardingForUser(user, workspace, {
      firstName,
      lastName,
    });

    return Object.assign(user, updatedUser);
  }

  private async findWorkspaceAndValidateInvitation({
    workspacePersonalInviteToken,
    workspaceInviteHash,
    email,
  }) {
    if (!workspacePersonalInviteToken && !workspaceInviteHash) {
      throw new AuthException(
        'No invite token or hash provided',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    const workspace = await this.workspaceRepository.findOneBy({
      inviteHash: workspaceInviteHash,
    });

    workspaceValidator.assertIsExist(
      workspace,
      new AuthException(
        'Workspace not found',
        AuthExceptionCode.WORKSPACE_NOT_FOUND,
      ),
    );

    if (!workspacePersonalInviteToken && !workspace.isPublicInviteLinkEnabled) {
      throw new AuthException(
        'Workspace does not allow public invites',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    if (workspacePersonalInviteToken && workspace.isPublicInviteLinkEnabled) {
      try {
        await this.userWorkspaceService.validateInvitation(
          workspacePersonalInviteToken,
          email,
        );
      } catch (err) {
        throw new AuthException(
          err.message,
          AuthExceptionCode.FORBIDDEN_EXCEPTION,
        );
      }
    }

    return workspace;
  }

  private async activateOnboardingForUser(
    user: User,
    workspace: Workspace,
    { firstName, lastName }: { firstName: string; lastName: string },
  ) {
    await this.onboardingService.setOnboardingConnectAccountPending({
      userId: user.id,
      workspaceId: workspace.id,
      value: true,
    });

    if (firstName === '' && lastName === '') {
      await this.onboardingService.setOnboardingCreateProfilePending({
        userId: user.id,
        workspaceId: workspace.id,
        value: true,
      });
    }
  }

  private async signUpOnNewWorkspace({
    email,
    passwordHash,
    firstName,
    lastName,
    picture,
  }: {
    email: string;
    passwordHash: string | undefined;
    firstName: string;
    lastName: string;
    picture: SignInUpServiceInput['picture'];
  }) {
    if (!this.environmentService.get('IS_MULTIWORKSPACE_ENABLED')) {
      const workspacesCount = await this.workspaceRepository.count();

      // let the creation of the first workspace
      if (workspacesCount > 0) {
        throw new AuthException(
          'New workspace setup is disabled',
          AuthExceptionCode.FORBIDDEN_EXCEPTION,
        );
      }
    }

    const workspaceToCreate = this.workspaceRepository.create({
      displayName: '',
      domainName: '',
      inviteHash: v4(),
      activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
    });

    const workspace = await this.workspaceRepository.save(workspaceToCreate);

    const imagePath = await this.uploadPicture(picture, workspace.id);

    const userToCreate = this.userRepository.create({
      email: email,
      firstName: firstName,
      lastName: lastName,
      defaultAvatarUrl: imagePath,
      canImpersonate: false,
      passwordHash,
      defaultWorkspace: workspace,
    });

    const user = await this.userRepository.save(userToCreate);

    await this.userWorkspaceService.create(user.id, workspace.id);

    await this.activateOnboardingForUser(user, workspace, {
      firstName,
      lastName,
    });

    await this.onboardingService.setOnboardingInviteTeamPending({
      workspaceId: workspace.id,
      value: true,
    });

    return user;
  }

  async uploadPicture(
    picture: string | null | undefined,
    workspaceId: string,
  ): Promise<string | undefined> {
    if (!picture) {
      return;
    }

    const buffer = await getImageBufferFromUrl(
      picture,
      this.httpService.axiosRef,
    );

    const type = await FileType.fromBuffer(buffer);

    const { paths } = await this.fileUploadService.uploadImage({
      file: buffer,
      filename: `${v4()}.${type?.ext}`,
      mimeType: type?.mime,
      fileFolder: FileFolder.ProfilePicture,
      workspaceId,
    });

    return paths[0];
  }
}
