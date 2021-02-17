import { GraphQLBoolean, GraphQLInputObjectType, GraphQLNonNull, GraphQLString } from 'graphql';
import GraphQLJSON from 'graphql-type-json';

export const BraintreePaymentInput = new GraphQLInputObjectType({
  name: 'BraintreePaymentInput',
  fields: () => ({
    nonce: { type: new GraphQLNonNull(GraphQLString) },
    type: { type: new GraphQLNonNull(GraphQLString) }, // TODO enum (PayPalAccount)
    details: { type: GraphQLJSON },
    binData: { type: GraphQLJSON },
    deviceData: { type: GraphQLJSON },
    description: { type: GraphQLString },
    vaulted: { type: GraphQLBoolean },
  }),
});
