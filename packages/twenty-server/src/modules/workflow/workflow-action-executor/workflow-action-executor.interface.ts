import { WorkflowAction } from 'src/modules/workflow/common/types/workflow-action.type';
import { WorkflowResult } from 'src/modules/workflow/common/types/workflow-result.type';

export interface WorkflowActionExecutor {
  execute({
    action,
    payload,
  }: {
    action: WorkflowAction;
    payload?: object;
  }): Promise<WorkflowResult>;
}