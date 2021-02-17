import { GraphQLNonNull, GraphQLString } from 'graphql';

import { getBraintreeGateway } from '../../../paymentProviders/braintree/gateway';

const generateBraintreeTokenForClient = (customerId = null): Promise<string> => {
  return new Promise((resolve, reject) => {
    const gateway = getBraintreeGateway();
    gateway.clientToken.generate(
      {
        // TODO: Including a customerId when generating the client token lets returning customers select from previously used payment method options, improving user experience over multiple checkouts.
        customerId: '843124238',
      },
      (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve(response.clientToken);
        }
      },
    );
  });
};

const PaymentProviderClientTokenQuery = {
  type: new GraphQLNonNull(GraphQLString),
  args: {
    provider: {
      type: new GraphQLNonNull(GraphQLString), // TODO should be an enum
      description: '',
    },
  },
  async resolve(_, args, req) {
    switch (args.provider) {
      case 'BRAINTREE':
        return generateBraintreeTokenForClient();
      default:
        throw new Error('Provider not supported');
    }
  },
};

export default PaymentProviderClientTokenQuery;
