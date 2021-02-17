import { PAYMENT_METHOD_TYPE } from '../../constants/paymentMethods';
import models from '../../models';
import { PaymentProvider } from '../PaymentProvider';

import PayPal from './paypal';

const BrainTree: PaymentProvider = {
  types: {
    paypal: PayPal,
  },

  processOrder: (order: typeof models.Order): Promise<typeof models.Order> => {
    switch (order.paymentMethod.type) {
      case PAYMENT_METHOD_TYPE.PAYPAL:
        return this.paypal.createOrder();
      default:
        throw new Error(`Braintree payment method type "${order.paymentMethod.type}" not supported yet`);
    }
  },
};

export default BrainTree;
