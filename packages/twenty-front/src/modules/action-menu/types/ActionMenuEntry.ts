import { ActionAvailableOn } from '@/action-menu/actions/types/ActionAvailableOn';
import { ConfirmationModalProps } from '@/ui/layout/modal/components/ConfirmationModal';
import { MouseEvent, ReactElement } from 'react';
import { IconComponent, MenuItemAccent } from 'twenty-ui';

export enum ActionMenuEntryType {
  Standard = 'Standard',
  WorkflowRun = 'WorkflowRun',
}

export enum ActionMenuEntryScope {
  Global = 'Global',
  RecordSelection = 'RecordSelection',
}

export type ActionMenuEntry = {
  type: ActionMenuEntryType;
  scope: ActionMenuEntryScope;
  key: string;
  label: string;
  shortLabel?: string;
  position: number;
  Icon: IconComponent;
  isPinned?: boolean;
  accent?: MenuItemAccent;
  availableOn?: ActionAvailableOn[];
  onClick?: (event?: MouseEvent<HTMLElement>) => void;
  ConfirmationModal?: ReactElement<ConfirmationModalProps>;
};
