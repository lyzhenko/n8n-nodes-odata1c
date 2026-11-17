import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class OData1cApi implements ICredentialType {
	name = 'odata1cApi';

	displayName = 'OData 1C API';

	// eslint-disable-next-line n8n-nodes-base/cred-class-field-documentation-url-miscased
	documentationUrl = 'https://github.com/lyzhenko/n8n-nodes-odata1c#credentials';

	icon = 'file:odata1c.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://1c.example.com/erp',
			description:
				'URL of the published infobase without /odata/standard.odata, for example https://1c.example.com/erp. The node appends /odata/standard.odata itself.',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
			description: '1C:Enterprise user with access to the OData interface',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
		},
		{
			displayName: 'Ignore SSL Issues',
			name: 'allowUnauthorizedCerts',
			type: 'boolean',
			default: true,
			description:
				'Whether to connect even if the TLS certificate cannot be verified (self-signed certificates are common for internal 1C servers)',
		},
		{
			displayName: 'Timeout (ms)',
			name: 'timeout',
			type: 'number',
			default: 60000,
			description: 'Maximum time to wait for a response, in milliseconds',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			auth: {
				username: '={{$credentials.username}}',
				password: '={{$credentials.password}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/odata/standard.odata/$metadata',
			method: 'GET',
			headers: {
				Accept: 'application/xml',
			},
			// Expression is evaluated by n8n's routing node; the type only allows boolean.
			skipSslCertificateValidation:
				'={{$credentials.allowUnauthorizedCerts}}' as unknown as boolean,
		},
	};
}
