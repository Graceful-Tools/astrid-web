// Astrid on Azure: one brand, one resource group (AWTD-1468).
// Guide: docs/deployment/AZURE.md. Parameters: deploy/azure/<brand>.bicepparam.
//
//   az deployment group create -g <rg> -f deploy/azure/main.bicep -p deploy/azure/<brand>.bicepparam
//
// What it creates:
//   - Log Analytics (console logs) + workspace-based Application Insights (traces,
//     once the managed OpenTelemetry agent is switched on: AZURE.md)
//   - A VNet: the Container Apps environment's subnet and Postgres's delegated subnet
//   - A user-assigned identity: reads Key Vault, uses Blob Storage, pulls from ACR
//   - Key Vault (RBAC, purge-protected) holding every secret the containers read
//   - Storage account + private container (STORAGE_DRIVER=azure-blob, Managed Identity)
//   - PostgreSQL Flexible Server, private access, built-in PgBouncer
//     (DATABASE_URL pooled on 6432, DATABASE_URL_DIRECT on 5432)
//   - Azure Cache for Redis, TLS only (REDIS_URL, REALTIME_BUS=redis)
//   - Container Apps: `app` (min 1 replica) and, behind deployWorker, `worker`
//   - Container Apps Jobs: `migrator` (manual; run before every roll) and one
//     scheduled `cron-*` Job per entry in vercel.json `crons`
//
// Variables the containers get are object keys below (NAME: value), so
// tests/rules/azure-bicep-matches-env-registry.test.ts can check each one
// against lib/env.ts. Keep them that way.

targetScope = 'resourceGroup'

// ── Identity of the deployment ───────────────────────────────────────────────

@description('Short prefix for every resource name, e.g. "wlp". Lowercase letters, digits and hyphens. At most 6 characters, so the cron Job names fit Azure\'s 32-character limit.')
@minLength(2)
@maxLength(6)
param name string

param location string = resourceGroup().location

@description('The app image, built for this brand (one image is one brand): e.g. myregistry.azurecr.io/tasks:1.4.0 or ghcr.io/graceful-tools/astrid-web:1.4.0-<brand>.')
param appImage string

@description('The migrator image of the SAME release: e.g. ghcr.io/graceful-tools/astrid-web:1.4.0-migrator. Brand-independent.')
param migratorImage string

@description('Registry login server for private images, e.g. myregistry.azurecr.io. Empty for public images.')
param registryServer string = ''

@description('Registry username. Empty with registryServer set means the managed identity pulls (give it AcrPull on the registry).')
param registryUsername string = ''

@secure()
@description('Registry password or token, with registryUsername.')
param registryPassword string = ''

// ── Public address ───────────────────────────────────────────────────────────

@description('The custom domain users reach, e.g. tasks.partner.example. Empty serves on the generated *.azurecontainerapps.io name.')
param customDomain string = ''

@description('Second pass of the custom-domain setup (AZURE.md): issue a managed certificate for customDomain and bind it. Leave false until the CNAME and asuid TXT records exist.')
param bindManagedCertificate bool = false

@description('Proxies in front of the app that append to X-Forwarded-For, counting Container Apps ingress itself: 1 direct, 2 behind Front Door or Application Gateway, 3 behind both.')
@minValue(1)
param trustedProxyDepth int = 1

@description('If non-empty, only these CIDRs may reach the app\'s ingress (e.g. your Front Door or Application Gateway egress). See AZURE.md before using: the cron Jobs call the app through the same ingress.')
param ingressAllowedCidrs array = []

// ── Sizing ───────────────────────────────────────────────────────────────────

@minValue(1)
param appMinReplicas int = 1
param appMaxReplicas int = 3
param appCpu string = '1.0'
param appMemory string = '2Gi'

@description('Concurrent requests per replica before scaling out. Open SSE streams count.')
param appConcurrentRequests int = 200

@description('The durable-job worker (scripts/job-worker.mjs, AWTD-1460). Off until the image you deploy ships that script.')
param deployWorker bool = false

@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
@description('Burstable has no built-in PgBouncer, so DATABASE_URL then points at the server directly.')
param postgresTier string = 'GeneralPurpose'
param postgresSku string = 'Standard_D2ds_v5'
param postgresVersion string = '16'
param postgresStorageGB int = 64
@minValue(7)
@maxValue(35)
param postgresBackupRetentionDays int = 14
param postgresGeoRedundantBackup bool = false
param postgresHighAvailability bool = false
param postgresAdminLogin string = 'astridadmin'
@secure()
param postgresAdminPassword string
param postgresDatabase string = 'tasks'

@description('Adopt an existing server by name: after a point-in-time restore (AZURE.md, "Backups and restore"), the restored server\'s name. Empty uses the generated name.')
param postgresServerName string = ''

@allowed(['Basic', 'Standard', 'Premium'])
param redisSku string = 'Standard'
param redisCapacity int = 1

param vnetAddressPrefix string = '10.40.0.0/16'
param appsSubnetPrefix string = '10.40.0.0/23'
param postgresSubnetPrefix string = '10.40.2.0/28'

// ── Settings and secrets ─────────────────────────────────────────────────────

@secure()
@description('NEXTAUTH_SECRET: 32+ characters. Rotating it signs everyone out.')
param nextauthSecret string

@secure()
@description('ENCRYPTION_KEY: 32+ characters. Never change it: stored credentials are unreadable without the original. Back it up with the database.')
param encryptionKey string

@secure()
@description('CRON_SECRET: the cron Jobs send it; every cron route refuses requests without it.')
param cronSecret string

@secure()
@description('Further secrets as { ENV_NAME: value }: SMTP_URL, SMTP_PASS, VAPID_PRIVATE_KEY, AUTH_SSO_CLIENT_SECRET, GOOGLE_CLIENT_SECRET, OPENAI_API_KEY ... Empty values are skipped. Each becomes a Key Vault secret.')
param optionalSecrets object = {}

@description('Plain (non-secret) runtime settings as { ENV_NAME: value }: FROM_EMAIL, EMAIL_TRANSPORT, AUTH_SSO_ISSUER, VAPID_PUBLIC_KEY ... NEXT_PUBLIC_* values are compiled into the image and ignored here.')
param appSettings object = {}

param tags object = {}

// ── Names ────────────────────────────────────────────────────────────────────

var suffix = uniqueString(resourceGroup().id, name)
var appName = '${name}-app'
var workerName = '${name}-worker'
var migratorName = '${name}-migrator'
var keyVaultName = take('${replace(name, '-', '')}kv${suffix}', 24)
var storageName = take('${replace(name, '-', '')}st${suffix}', 24)
var postgresName = empty(postgresServerName) ? '${name}-pg-${suffix}' : postgresServerName
var redisName = '${name}-redis-${suffix}'
var blobContainerName = 'uploads'
var crons = loadJsonContent('../../vercel.json', '$.crons')
var pooled = postgresTier != 'Burstable'

// Built-in role definitions.
var roles = {
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  storageBlobDelegator: 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a'
}

@description('Key Vault and Container Apps secret name for an environment variable: NEXTAUTH_SECRET -> nextauth-secret.')
func secretName(envName string) string => toLower(replace(envName, '_', '-'))

// ── Observability ────────────────────────────────────────────────────────────

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${name}-insights'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

// ── Network ──────────────────────────────────────────────────────────────────

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${name}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [vnetAddressPrefix] }
    subnets: [
      {
        name: 'apps'
        properties: {
          addressPrefix: appsSubnetPrefix
          delegations: [{ name: 'apps', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'postgres'
        properties: {
          addressPrefix: postgresSubnetPrefix
          delegations: [{ name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }]
        }
      }
    ]
  }
}

resource postgresDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  // Named for the deployment, not the server, so a restored server joins the same zone.
  name: '${name}-${suffix}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: postgresDns
  name: '${name}-vnet'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

// ── Identity and Key Vault ───────────────────────────────────────────────────

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${name}-identity'
  location: location
  tags: tags
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    // ENCRYPTION_KEY lives here. Purge protection means a deleted vault can be
    // recovered for 90 days and cannot be destroyed sooner, by anyone.
    enablePurgeProtection: true
  }
}

resource vaultReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, identity.id, roles.keyVaultSecretsUser)
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
  }
}

// ── Blob Storage ─────────────────────────────────────────────────────────────

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_ZRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // The app signs in with the managed identity and hands out user-delegation
    // SAS URLs, so no account key is ever needed.
    allowSharedKeyAccess: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 14 }
    containerDeleteRetentionPolicy: { enabled: true, days: 14 }
  }
}

resource blobContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: blobContainerName
  properties: { publicAccess: 'None' }
}

resource blobWriter 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: blobContainer
  name: guid(blobContainer.id, identity.id, roles.storageBlobDataContributor)
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDataContributor)
  }
}

resource blobDelegator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, identity.id, roles.storageBlobDelegator)
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDelegator)
  }
}

// ── PostgreSQL ───────────────────────────────────────────────────────────────

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  tags: tags
  sku: { name: postgresSku, tier: postgresTier }
  properties: {
    version: postgresVersion
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    authConfig: { passwordAuth: 'Enabled' }
    storage: { storageSizeGB: postgresStorageGB, autoGrow: 'Enabled' }
    backup: {
      backupRetentionDays: postgresBackupRetentionDays
      geoRedundantBackup: postgresGeoRedundantBackup ? 'Enabled' : 'Disabled'
    }
    highAvailability: { mode: postgresHighAvailability ? 'ZoneRedundant' : 'Disabled' }
    network: {
      delegatedSubnetResourceId: '${vnet.id}/subnets/postgres'
      privateDnsZoneArmResourceId: postgresDns.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [postgresDnsLink]
}

resource pgbouncer 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = if (pooled) {
  parent: postgres
  name: 'pgbouncer.enabled'
  properties: { value: 'true', source: 'user-override' }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: postgresDatabase
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
  dependsOn: [pgbouncer]
}

var postgresCredentials = '${uriComponent(postgresAdminLogin)}:${uriComponent(postgresAdminPassword)}'
var postgresDirectUrl = 'postgresql://${postgresCredentials}@${postgres.properties.fullyQualifiedDomainName}:5432/${database.name}?sslmode=require'
var postgresPooledUrl = pooled
  ? 'postgresql://${postgresCredentials}@${postgres.properties.fullyQualifiedDomainName}:6432/${database.name}?sslmode=require'
  : postgresDirectUrl

// ── Redis ────────────────────────────────────────────────────────────────────

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: redisName
  location: location
  tags: tags
  properties: {
    sku: { name: redisSku, family: redisSku == 'Premium' ? 'P' : 'C', capacity: redisCapacity }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    redisVersion: '6'
  }
}

// ── Secrets ──────────────────────────────────────────────────────────────────
// Written to Key Vault on every deployment; the containers read them by
// reference through the identity, so no value is stored on a container app.

var requiredSecrets = {
  NEXTAUTH_SECRET: nextauthSecret
  ENCRYPTION_KEY: encryptionKey
  CRON_SECRET: cronSecret
}

var generatedSecrets = {
  DATABASE_URL: postgresPooledUrl
  DATABASE_URL_DIRECT: postgresDirectUrl
  REDIS_URL: 'rediss://:${uriComponent(redis.listKeys().primaryKey)}@${redis.properties.hostName}:${redis.properties.sslPort}'
}

var optionalSecretNames = filter(objectKeys(optionalSecrets), key => !empty(optionalSecrets[key]))
var secretNames = concat(objectKeys(requiredSecrets), ['DATABASE_URL', 'DATABASE_URL_DIRECT', 'REDIS_URL'], optionalSecretNames)
var secretValues = union(optionalSecrets, generatedSecrets, requiredSecrets)

resource vaultSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [
  for envName in secretNames: {
    parent: vault
    name: secretName(envName)
    properties: { value: secretValues[envName] }
  }
]

var registrySecret = empty(registryPassword) ? [] : [{ name: 'registry-password', value: registryPassword }]

var registries = empty(registryServer)
  ? []
  : [
      empty(registryUsername)
        ? { server: registryServer, identity: identity.id }
        : { server: registryServer, username: registryUsername, passwordSecretRef: 'registry-password' }
    ]

/** Container Apps secrets that point at Key Vault, for the given variables. */
var vaultReferences = map(secretNames, envName => {
  name: secretName(envName)
  keyVaultUrl: '${vault.properties.vaultUri}secrets/${secretName(envName)}'
  identity: identity.id
})

// ── Container Apps environment ───────────────────────────────────────────────

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: '${name}-env'
  location: location
  tags: tags
  properties: {
    vnetConfiguration: {
      infrastructureSubnetId: '${vnet.id}/subnets/apps'
      internal: false
    }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    // Traces: the managed OpenTelemetry agent is configurable only through a
    // preview API version, so it is one CLI step after deployment instead
    // (AZURE.md, "Logs and traces"). Console logs (pino JSON) land in Log
    // Analytics from here.
  }
}

resource managedCertificate 'Microsoft.App/managedEnvironments/managedCertificates@2025-01-01' = if (!empty(customDomain) && bindManagedCertificate) {
  parent: environment
  name: '${name}-cert'
  location: location
  tags: tags
  properties: {
    subjectName: customDomain
    domainControlValidation: 'CNAME'
  }
  // No dependsOn the app: this pass runs only after the first pass added the
  // hostname to it (AZURE.md, "Custom domain"), and the app binds this.
}

var generatedHost = '${appName}.${environment.properties.defaultDomain}'
var publicUrl = 'https://${empty(customDomain) ? generatedHost : customDomain}'

// ── Settings every container shares ──────────────────────────────────────────

var platformSettings = {
  NEXTAUTH_URL: publicUrl
  STORAGE_DRIVER: 'azure-blob'
  AZURE_STORAGE_ACCOUNT: storage.name
  AZURE_STORAGE_CONTAINER: blobContainerName
  AZURE_CLIENT_ID: identity.properties.clientId
  REALTIME_BUS: 'redis'
  TRUSTED_PROXY_DEPTH: string(trustedProxyDepth)
  OTEL_SERVICE_NAME: name
}

// An operator's appSettings override the platform's; a name that is a secret
// is never also set in plain text, and an empty value is not set at all.
var plainEnv = map(
  filter(items(union(platformSettings, appSettings)), setting => !contains(secretNames, setting.key) && !empty(string(setting.value))),
  setting => { name: setting.key, value: string(setting.value) }
)
var secretEnv = map(secretNames, envName => { name: envName, secretRef: secretName(envName) })
var appEnv = concat(plainEnv, secretEnv)

var identityConfig = {
  type: 'UserAssigned'
  userAssignedIdentities: { '${identity.id}': {} }
}

// ── App ──────────────────────────────────────────────────────────────────────

resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: appName
  location: location
  tags: tags
  identity: identityConfig
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: concat(vaultReferences, registrySecret)
      registries: registries
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        // Container Apps ingress ends a request at 240 s and the limit is not
        // configurable. The SSE route pings every 15 s and the client reconnects
        // (replaying from the bus's 15-minute window), as it does at Vercel's
        // 300 s ceiling. AZURE.md, "Real-time updates".
        ipSecurityRestrictions: map(ingressAllowedCidrs, cidr => {
          name: replace(replace(cidr, '/', '-'), '.', '-')
          action: 'Allow'
          ipAddressRange: cidr
        })
        customDomains: empty(customDomain)
          ? []
          : [
              bindManagedCertificate
                ? {
                    name: customDomain
                    bindingType: 'SniEnabled'
                    certificateId: managedCertificate.id
                  }
                : { name: customDomain, bindingType: 'Disabled' }
            ]
      }
    }
    template: {
      containers: [
        {
          name: 'app'
          image: appImage
          resources: { cpu: json(appCpu), memory: appMemory }
          env: appEnv
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 5
              failureThreshold: 30
            }
            {
              // Readiness, not liveness, on /api/health: it checks the database,
              // and a database blip should take a replica out of rotation, not
              // restart every replica at once.
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000 }
              periodSeconds: 10
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              tcpSocket: { port: 3000 }
              periodSeconds: 30
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: appMinReplicas
        maxReplicas: appMaxReplicas
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: string(appConcurrentRequests) } }
          }
        ]
      }
    }
  }
  dependsOn: [vaultReader, vaultSecrets, blobWriter, blobDelegator]
}

// ── Worker (AWTD-1460) ───────────────────────────────────────────────────────

resource worker 'Microsoft.App/containerApps@2025-01-01' = if (deployWorker) {
  name: workerName
  location: location
  tags: tags
  identity: identityConfig
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: concat(vaultReferences, registrySecret)
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: appImage
          command: ['node', 'scripts/job-worker.mjs']
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: appEnv
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [vaultReader, vaultSecrets, blobWriter, blobDelegator]
}

// ── Migrator: run before every roll ──────────────────────────────────────────

resource migrator 'Microsoft.App/jobs@2025-01-01' = {
  name: migratorName
  location: location
  tags: tags
  identity: identityConfig
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      replicaTimeout: 1800
      replicaRetryLimit: 0
      secrets: concat(
        filter(vaultReferences, ref => contains([secretName('DATABASE_URL'), secretName('DATABASE_URL_DIRECT')], ref.name)),
        registrySecret
      )
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'migrator'
          image: migratorImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'DATABASE_URL', secretRef: secretName('DATABASE_URL') }
            { name: 'DATABASE_URL_DIRECT', secretRef: secretName('DATABASE_URL_DIRECT') }
          ]
        }
      ]
    }
  }
  dependsOn: [vaultReader, vaultSecrets]
}

// ── Cron: one scheduled Job per vercel.json entry ────────────────────────────
// Each run starts a container that calls one route once and exits
// (scripts/cron-runner.mjs --run). Times are UTC, as on Vercel.

resource cronJobs 'Microsoft.App/jobs@2025-01-01' = [
  for job in crons: {
    name: '${name}-cron-${last(split(job.path, '/'))}'
    location: location
    tags: tags
    identity: identityConfig
    properties: {
      environmentId: environment.id
      workloadProfileName: 'Consumption'
      configuration: {
        triggerType: 'Schedule'
        scheduleTriggerConfig: { cronExpression: job.schedule, parallelism: 1, replicaCompletionCount: 1 }
        // The runner's own limit is 15 minutes; give it a minute more to report.
        replicaTimeout: 960
        replicaRetryLimit: 0
        secrets: concat(filter(vaultReferences, ref => ref.name == secretName('CRON_SECRET')), registrySecret)
        registries: registries
      }
      template: {
        containers: [
          {
            name: 'cron'
            image: appImage
            command: ['node', 'scripts/cron-runner.mjs', '--run', job.path]
            resources: { cpu: json('0.25'), memory: '0.5Gi' }
            env: [
              { name: 'CRON_SECRET', secretRef: secretName('CRON_SECRET') }
              { name: 'CRON_BASE_URL', value: 'https://${generatedHost}' }
            ]
          }
        ]
      }
    }
    dependsOn: [vaultReader, vaultSecrets]
  }
]

// ── Outputs ──────────────────────────────────────────────────────────────────

output appUrl string = publicUrl
output appFqdn string = app.properties.configuration.ingress.fqdn
@description('Value of the asuid.<customDomain> TXT record.')
output customDomainVerificationId string = environment.properties.customDomainConfiguration.customDomainVerificationId
output keyVaultName string = vault.name
output appInsightsName string = insights.name
output migratorJobName string = migrator.name
output cronJobNames array = [for (job, i) in crons: cronJobs[i].name]
output postgresServerName string = postgres.name
output storageAccountName string = storage.name
output environmentStaticIp string = environment.properties.staticIp
