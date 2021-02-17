import braintree from 'braintree';

import INTERVALS from '../../constants/intervals';

const MONTHLY_PLAN_ID = 'monthly';
const YEARLY_PLAN_ID = 'yearly';

// TODO We're supposed to fetch this from the host
export const getBraintreeGateway = () =>
  new braintree.BraintreeGateway({
    environment: braintree.Environment.Sandbox,
    merchantId: process.env.BRAINTREE_MERCHANT_ID,
    publicKey: process.env.BRAINTREE_PUBLIC_KEY,
    privateKey: process.env.BRAINTREE_PRIVATE_KEY,
  });

const findCustomer = (gateway, customerId) => {
  return new Promise(resolve => {
    gateway.customer.find(customerId, (err, customer) => {
      if (err) {
        // Ignore
        resolve(null);
      } else {
        resolve(customer);
      }
    });
  });
};

const updateCustomer = (gateway, customerId, order) => {
  return new Promise((resolve, reject) => {
    gateway.customer.update(customerId, { paymentMethodNonce: order.paymentMethod.token }, (err, result) => {
      if (err) {
        reject(null);
      } else {
        resolve(result.customer);
      }
    });
  });
};

const createCustomer = (gateway, order) => {
  return new Promise((resolve, reject) => {
    gateway.customer.create(
      {
        firstName: 'Charity',
        lastName: 'Smith',
        // TODO add more info
        paymentMethodNonce: order.paymentMethod.token,
      },
      (err, result) => {
        if (result.success) {
          resolve(result.customer);
        } else {
          reject(err || result);
        }
      },
    );
  });
};

/**
 * TODO: Customer ID should be stored somewhere in FromCollective data
 */
const getOrCreateCustomerForOrder = async (gateway, order) => {
  const customerId = '843124238';
  const existingCustomer = customerId && (await findCustomer(gateway, customerId));
  if (existingCustomer) {
    return updateCustomer(gateway, existingCustomer['id'], order);
  } else {
    return createCustomer(gateway, order);
  }
};

const callTransactionSale = (gateway, order) => {
  return new Promise((resolve, reject) => {
    gateway.transaction.sale(
      {
        amount: order.totalAmount / 100,
        paymentMethodNonce: order.paymentMethod.token,
        deviceData: order.paymentMethod.data?.deviceData,
        // TODO add device data for fraud prevention
        transactionSource: order.interval ? 'recurring_first' : undefined,
        customFields: {
          collective: order.collective.slug,
          order: order.id,
        },
        options: {
          submitForSettlement: true,
        },
      },
      (err, result) => {
        // TODO sanitize & log errors
        if (err) {
          // Node exception (e.g. connection refused)
          reject(err);
        } else if (!result.success) {
          // TODO find a better way to check that
          const deepErrors = result.errors.deepErrors();
          reject(deepErrors[0] ? deepErrors[0].message : result.message);
        } else {
          resolve(result);
        }
      },
    );
  });
};

const callCreateSubscription = async (gateway, order) => {
  const customer = await getOrCreateCustomerForOrder(gateway, order);
  return new Promise((resolve, reject) => {
    gateway.subscription.create(
      {
        paymentMethodToken: customer['paymentMethods'][0].token, // TODO make sure we're hitting the right PM
        paymentMethodNonce: order.paymentMethod.token,
        planId: order.interval === INTERVALS.MONTH ? MONTHLY_PLAN_ID : YEARLY_PLAN_ID,
        neverExpires: true,
        price: (order.totalAmount / 100).toString(),
        options: {
          startImmediately: true,
          paypal: {
            description: order.description,
          },
        },
      },
      (err, result) => {
        // TODO sanitize & log errors
        if (err) {
          // Node exception (e.g. connection refused)
          reject(err);
        } else if (!result.success) {
          // TODO find a better way to check that
          const deepErrors = result.errors.deepErrors();
          reject(deepErrors[0] ? deepErrors[0].message : result.message);
        } else {
          resolve(result.subscription.transactions[0]);
        }
      },
    );
  });
};

export const executePayment = async order => {
  // TODO Fetch braintree account from host
  // We store the nonce as `token`
  const gateway = getBraintreeGateway();
  if (order.interval) {
    return callCreateSubscription(gateway, order);
  } else {
    return callTransactionSale(gateway, order);
  }
};
