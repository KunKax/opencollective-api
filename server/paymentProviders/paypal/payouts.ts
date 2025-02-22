/* eslint-disable camelcase */

import { isNil, round, toNumber } from 'lodash';
import moment from 'moment';

import activities from '../../constants/activities';
import status from '../../constants/expense_status';
import logger from '../../lib/logger';
import * as paypal from '../../lib/paypal';
import { createFromPaidExpense as createTransactionFromPaidExpense } from '../../lib/transactions';
import models from '../../models';
import { PayoutItemDetails } from '../../types/paypal';

export const payExpensesBatch = async (expenses: any[]): Promise<any[]> => {
  const [firstExpense] = expenses;
  const isSameHost = expenses.every(
    e =>
      !isNil(e.collective?.HostCollectiveId) &&
      e.collective.HostCollectiveId === firstExpense.collective.HostCollectiveId,
  );
  if (!isSameHost) {
    throw new Error('All expenses should have collective prop populated and belong to the same Host.');
  }

  const host = await firstExpense.collective.getHostCollective();
  if (!host) {
    throw new Error(`Could not find the host embursing the expense.`);
  }

  const [connectedAccount] = await host.getConnectedAccounts({
    where: { service: 'paypal', deletedAt: null },
  });
  if (!connectedAccount) {
    throw new Error(`Host is not connected to PayPal Payouts.`);
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const getExpenseItem = expense => ({
    note: `Expense #${expense.id}: ${expense.description}`,
    amount: {
      currency: expense.currency,
      value: round(expense.amount / 100, 2),
    },
    receiver: expense.PayoutMethod.data.email,
    sender_item_id: expense.id,
  });

  const requestBody = {
    sender_batch_header: {
      recipient_type: 'EMAIL',
      email_message: 'Good news, your expense was paid!',
      sender_batch_id: `${firstExpense.collective.slug}-${moment().format('DDMMYYYY-HHmm')}`,
      email_subject: `Expense Payout for ${firstExpense.collective.name}`,
    },
    items: expenses.map(getExpenseItem),
  };

  try {
    const response = await paypal.executePayouts(connectedAccount, requestBody);
    const updateExpenses = expenses.map(async e => {
      await e.update({ data: { ...e.data, ...response.batch_header }, status: status.PROCESSING });
      const user = await models.User.findByPk(e.lastEditedById);
      await e.createActivity(activities.COLLECTIVE_EXPENSE_PROCESSING, user);
    });
    return Promise.all(updateExpenses);
  } catch (error) {
    const updateExpenses = expenses.map(async e => {
      await e.update({ status: status.ERROR });
      const user = await models.User.findByPk(e.lastEditedById);
      await e.createActivity(activities.COLLECTIVE_EXPENSE_ERROR, user, { error: { message: error.message } });
    });
    return Promise.all(updateExpenses);
  }
};

export const checkBatchItemStatus = async (item: PayoutItemDetails, expense: any, host: any) => {
  // Reload up-to-date values to avoid race conditions when processing batches.
  await expense.reload();
  if (expense.data.payout_batch_id !== item.payout_batch_id) {
    throw new Error(`Item does not belongs to expense it claims it does.`);
  }

  const paymentProcessorFeeInHostCurrency = round(toNumber(item.payout_item_fee?.value) * 100);
  switch (item.transaction_status) {
    case 'SUCCESS':
      if (expense.status !== status.PAID) {
        await createTransactionFromPaidExpense(
          host,
          null,
          expense,
          null,
          expense.UserId,
          paymentProcessorFeeInHostCurrency,
          0,
          0,
          item,
        );
        await expense.setPaid(expense.lastEditedById);
        const user = await models.User.findByPk(expense.lastEditedById);
        await expense.createActivity(activities.COLLECTIVE_EXPENSE_PAID, user);
      }
      break;
    case 'FAILED':
    case 'BLOCKED':
    case 'REFUNDED':
    case 'RETURNED':
    case 'REVERSED':
      if (expense.status !== status.ERROR) {
        await expense.setError(expense.lastEditedById);
        await expense.createActivity(
          activities.COLLECTIVE_EXPENSE_ERROR,
          { id: expense.lastEditedById },
          { error: item.errors },
        );
      }
      break;
    // Ignore cases
    case 'ONHOLD':
    case 'UNCLAIMED': // Link sent to a non-paypal user, waiting for being claimed.
    case 'PENDING':
    default:
      logger.debug(`Expense is still being processed, nothing to do but wait.`);
      break;
  }
  await expense.update({ data: item });
  return expense;
};

export const checkBatchStatus = async (batch: any[]): Promise<any[]> => {
  const [firstExpense] = batch;
  const host = await firstExpense.collective.getHostCollective();
  if (!host) {
    throw new Error(`Could not find the host embursing the expense.`);
  }

  const [connectedAccount] = await host.getConnectedAccounts({
    where: { service: 'paypal', deletedAt: null },
  });
  if (!connectedAccount) {
    throw new Error(`Host is not connected to PayPal Payouts.`);
  }

  const batchId = firstExpense.data.payout_batch_id;
  const batchInfo = await paypal.getBatchInfo(connectedAccount, batchId);
  const checkExpense = async (expense: any): Promise<any> => {
    try {
      const item = batchInfo.items.find(i => i.payout_item.sender_item_id === expense.id.toString());
      if (!item) {
        throw new Error('Could not find expense in payouts batch');
      }
      await checkBatchItemStatus(item, expense, host);
    } catch (e) {
      console.error(e);
    }
  };

  for (const expense of batch) {
    await checkExpense(expense);
  }
  return batch;
};
