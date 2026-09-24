// Response shapes of the CCX admin REST API (rest/admin/legacy/admin in
// ccx-backend). Field names were observed live on 2026-09-24.

export interface AdminLoginResponse {
  id: string;
  login: string;
}

export interface AuthCheckResponse {
  id: string;
  login: string;
  isAdmin?: boolean;
  scopes?: Array<{ id: string; type: string; role: string; name: string }>;
}

export interface Job {
  job_id?: string;
  type?: string;
  user?: string;
  status?: string;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  messages?: string[];
  text?: string;
  data?: unknown;
}

export interface Datastore {
  id: string;
  status: string;
  status_text: string;
  cloud_provider: string;
  type: string;
  name: string;
  user_login: string;
  internal_id: number;
  size: number;
  created_at: string;
  current_job?: Job;
}

export interface ListDatastoresResponse {
  clusters: Datastore[];
}

export interface Host {
  id: string;
  cluster_id: string;
  instance_id: string;
  instance_type: string;
  az: string;
  cloud_provider: string;
}

export interface Node {
  unique_id: number;
  hostname: string;
  host_status: string;
  role: string;
  version: string;
  host?: Host | null;
  node_type: string;
  ip: string;
  last_seen: string;
  service_started_at: string;
}

export interface GetDatastoreResponse extends Datastore {
  nodes: Node[] | null;
}

export interface ListNodesResponse {
  nodes: {
    db_nodes: Node[] | null;
    lb_nodes: Node[] | null;
  };
}

export interface AuditLine {
  text: string;
  user: string;
  time: string;
  type: string;
  data: unknown;
}

export interface AuditResponse {
  lines: AuditLine[];
}

export interface User {
  id: string;
  login: string;
  first_name: string;
  last_name: string;
  created_at: string;
  suspended: boolean;
  deleted: boolean;
}

export interface ListUsersResponse {
  users: User[];
}

export interface CountResponse {
  count: number;
}

export interface CmonVersionResponse {
  cmon_version: string;
}

export interface SuccessResponse {
  success: boolean;
}

export interface DeleteResponse {
  deleted: boolean;
}

export interface VpcsAllResponse {
  region: string;
  aws_num_vpcs: number;
  ccx_num_vpcs: number;
  aws_vpc_ids: string[] | null;
  ccx_vpc_ids: string[] | null;
  aws_dangling_vpc_ids: string[] | null;
  ccx_dangling_vpc_ids: string[] | null;
}

export interface InstancesTypeUsage {
  instances_type: string;
  hours: number;
}

export interface VolumesTypeUsage {
  volume_type: string;
  iops: number;
  iops_per_hour: number;
  gib_per_hours: number;
  average_gib: number;
}

export interface UsageDatastore {
  created_at: string;
  deleted_at: string | null;
  datastore: string;
  custom_values?: Record<string, string>;
  type: string;
  nodes_count: number;
  customer_id: string;
  customer_reference?: string;
  vendor: string;
  instances_types_usage: InstancesTypeUsage[];
  volumes_types_usage: VolumesTypeUsage[];
  network_egress_usage_gib: number;
  backups: {
    taken: number;
    taken_size_gib: number;
    removed: number;
    removed_size_gib: number;
  };
}

export interface UsageDatastoresResponse {
  datastores: UsageDatastore[];
  from: string;
  to: string;
}
