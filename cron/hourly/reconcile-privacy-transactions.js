#!/usr/bin/env node
import '../../server/env';

import moment from 'moment';

import { Service as ConnectedAccountServices } from '../../server/constants/connected_account';
import { PAYMENT_METHOD_SERVICE, PAYMENT_METHOD_TYPE } from '../../server/constants/paymentMethods';
import { getFxRate } from '../../server/lib/currency';
import logger from '../../server/lib/logger';
import * as privacy from '../../server/lib/privacy';
import models, { sequelize } from '../../server/models';

const START_DATE = '2021-02-01T00:00:00Z';
const DRY = process.env.DRY;

export async function run() {
  logger.info('Reconciling Privacy.com Credit Card transactions...');
  if (DRY) {
    logger.warn(`Running DRY, no changes to the DB`);
  }

  const connectedAccounts = await models.ConnectedAccount.findAll({
    where: { service: ConnectedAccountServices.PRIVACY },
  });
  logger.info(`Found ${connectedAccounts.length} connected Privacy accounts...`);

  for (const connectedAccount of connectedAccounts) {
    const host = await models.Collective.findByPk(connectedAccount.CollectiveId);
    const cards = await models.PaymentMethod.findAll({
      where: {
        service: PAYMENT_METHOD_SERVICE.PRIVACY,
        type: PAYMENT_METHOD_TYPE.CREDITCARD,
        limitedToHostCollectiveIds: [connectedAccount.CollectiveId],
      },
    });
    logger.info(`Found ${cards.length} cards connected to host #${connectedAccount.CollectiveId} ${host.slug}...`);

    for (const card of cards) {
      const lastSyncedTransaction = await models.Transaction.findOne({
        where: { PaymentMethodId: card.id },
        order: [['createdAt', 'desc']],
      });
      const begin = lastSyncedTransaction
        ? moment(lastSyncedTransaction.createdAt).add(1, 'second').toISOString()
        : START_DATE;
      logger.info(`Fetching transactions since ${begin}`);

      const { data: transactions } = await privacy.listTransactions(
        connectedAccount.token,
        card.token,
        {
          begin,
          // Assumption: We won't have more than 200 transactions out of sync.
          // eslint-disable-next-line camelcase
          page_size: 200,
        },
        'approvals',
      );
      const hostCurrencyFxRate = await getFxRate(card.currency, host.currency);

      if (DRY) {
        logger.info(`Found ${transactions.length} pending transactions...`);
        logger.debug(JSON.stringify(transactions, null, 2));
      } else {
        logger.info(`Syncing ${transactions.length} pending transactions...`);
        await sequelize
          .transaction(t =>
            models.Transaction.bulkCreate(
              transactions.map(transaction => {
                const amount = -1 * transaction.amount;
                return {
                  CollectiveId: card.CollectiveId,
                  HostCollectiveId: connectedAccount.CollectiveId,
                  PaymentMethodId: card.id,
                  createdAt: transaction.created,
                  description: transaction.merchant.descriptor,
                  type: 'DEBIT',
                  currency: card.currency,
                  amount,
                  netAmountInCollectiveCurrency: amount,
                  hostCurrency: host.currency,
                  amountInHostCurrency: Math.round(amount * hostCurrencyFxRate),
                  paymentProcessorFeeInHostCurrency: 0,
                  hostFeeInHostCurrency: 0,
                  platformFeeInHostCurrency: 0,
                  hostCurrencyFxRate,
                };
              }),
              { validate: true, transaction: t },
            ),
          )
          .catch(e => {
            logger.warn(`Error while syncing host ${connectedAccount.CollectiveId}`);
            logger.error(e);
          });
      }
    }
  }
}

if (require.main === module) {
  run()
    .then(() => {
      process.exit(0);
    })
    .catch(e => {
      console.error(e);
      process.exit(1);
    });
}
